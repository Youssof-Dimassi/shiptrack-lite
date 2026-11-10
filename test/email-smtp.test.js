// Sends a real email over SMTP to a small pretend mail server.

import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { after, describe, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";

const received = [];

const mailServer = net.createServer((socket) => {
  let inData = false;
  let buffer = "";
  let message = "";
  socket.write("220 test ready\r\n");

  socket.on("data", (chunk) => {
    buffer += chunk.toString();

    for (;;) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        received.push(message + buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        inData = false;
        message = "";
        socket.write("250 stored\r\n");
        continue;
      }

      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);

      if (line.toUpperCase() === "DATA") {
        inData = true;
        socket.write("354 go ahead\r\n");
      } else if (line.toUpperCase() === "QUIT") {
        socket.end("221 bye\r\n");
        return;
      } else {
        if (line.toUpperCase().startsWith("RCPT TO")) message += `${line}\n`;
        socket.write("250 ok\r\n");
      }
    }
  });
  socket.on("error", () => {});
});

mailServer.listen(0, "127.0.0.1");
await once(mailServer, "listening");

process.env.EMAIL_TRANSPORT = "";
process.env.SMTP_URL = `smtp://127.0.0.1:${mailServer.address().port}`;
process.env.EMAIL_FROM = "ShipTrack Test <test@example.com>";
process.env.APP_URL = "https://shiptrack.example/";

const { PASSWORD, createAdmin, createClient, createLoggedInUser, drainJobs, uniqueEmail } = await import("./helpers.js");
const { db } = await import("../src/db/database.js");

after(() => mailServer.close());

describe("sending email over SMTP", () => {
  it("delivers the confirmation email with the configured site address", async () => {
    const email = uniqueEmail();
    const response = await createClient()("POST", "/api/auth/register", { name: "Sam", email, password: PASSWORD });
    assert.equal(response.status, 201);
    await drainJobs();

    for (let i = 0; i < 100 && received.length === 0; i += 1) await wait(50);

    assert.equal(received.length, 1);
    const message = received[0].replace(/=\r?\n/g, "");
    assert.match(message, new RegExp(`RCPT TO:<${email}>`, "i"));
    assert.match(message, /From: ShipTrack Test <test@example\.com>/);
    assert.match(message, /Subject: Confirm your ShipTrack Lite email/);
    assert.match(message, /https:\/\/shiptrack\.example\/confirm-email\?token=/);
  });

  it("delivers update emails with the one-click unsubscribe headers", async () => {
    const { client: admin } = await createAdmin();
    const { client, email } = await createLoggedInUser();
    db.prepare("UPDATE users SET email_confirmed_at = ? WHERE email = ?").run(new Date().toISOString(), email);
    await client("POST", "/api/my-shipments", { trackingNumber: "ST10000001" });

    await admin("POST", "/api/admin/shipments/ST10000001/events", { status: "Delivered", location: "Paris", description: "Delivered" });
    await drainJobs();

    // Long header lines are folded onto the next line in real email, so join them back up.
    const message = received.find((raw) => raw.includes("ST10000001: Delivered"));
    assert.ok(message, "the update email was not delivered");
    const headers = message.replace(/\r?\n[ \t]+/g, " ");
    assert.match(headers, /List-Unsubscribe: <https:\/\/shiptrack\.example\/api\/notifications\/unsubscribe\?token=[\w-]+>/);
    assert.match(headers, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  });
});
