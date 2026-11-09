// A broken mail server must never break the website.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.EMAIL_TRANSPORT = "";
process.env.SMTP_URL = "smtp://127.0.0.1:1"; // nothing is listening here

const { PASSWORD, createClient, uniqueEmail } = await import("./helpers.js");

describe("when the mail server is down", () => {
  it("still lets people sign up and ask for a reset", async () => {
    const email = uniqueEmail();
    const client = createClient();

    assert.equal((await client("POST", "/api/auth/register", { name: "Sam", email, password: PASSWORD })).status, 201);
    assert.equal((await client("GET", "/api/auth/me")).status, 200);
    assert.equal((await client("POST", "/api/auth/forgot-password", { email })).status, 200);

    // Give the failed delivery time to happen, proving it doesn't crash the app.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await client("GET", "/api/health")).status, 200);
  });
});
