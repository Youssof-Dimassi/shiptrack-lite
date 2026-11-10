import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser, drainJobs } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { sentEmails } = await import("../src/email/mailer.js");
const { createShipment } = await import("../src/models/shipments.js");

const ME = "/api/auth/me";
const PREFERENCES = "/api/notifications/preferences";
const UNSUBSCRIBE = "/api/notifications/unsubscribe";
const UPDATE = { status: "Out for Delivery", location: "Rome", description: "Out with the courier" };

let admin;

before(async () => {
  ({ client: admin } = await createAdmin());
});

beforeEach(async () => {
  await drainJobs();
  sentEmails.length = 0;
});

function newShipment() {
  return createShipment({ origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" }).trackingNumber;
}

function confirm(email) {
  db.prepare("UPDATE users SET email_confirmed_at = ? WHERE email = ?").run(new Date().toISOString(), email);
}

// A confirmed customer who has saved the shipment.
async function follower(trackingNumber, { confirmed = true } = {}) {
  const user = await createLoggedInUser();
  if (confirmed) confirm(user.email);
  await user.client("POST", "/api/my-shipments", { trackingNumber });
  await drainJobs();
  sentEmails.length = 0;
  return user;
}

function postUpdate(trackingNumber, update = UPDATE) {
  return admin("POST", `/api/admin/shipments/${trackingNumber}/events`, update);
}

// Every email except sign-up confirmations, so a broken update email (for
// example one with a blank tracking number) is still counted.
async function emailsAfterJobs() {
  await drainJobs();
  return sentEmails.filter((email) => !email.subject.startsWith("Confirm your"));
}

function unsubscribeToken(email) {
  return email.text.match(/unsubscribe\?token=([\w-]+)/)[1];
}

describe("emails about shipment updates", () => {
  it("are sent in the background, not during the request", async () => {
    const number = newShipment();
    await follower(number);

    assert.equal((await postUpdate(number)).status, 201);
    assert.equal(sentEmails.length, 0);
    assert.equal((await emailsAfterJobs()).length, 1);
  });

  it("go to a customer who saved the shipment, with the details and links", async () => {
    const number = newShipment();
    const { email } = await follower(number);
    await postUpdate(number);

    const [message] = await emailsAfterJobs();
    assert.equal(message.to, email);
    assert.equal(message.subject, `${number}: Out for Delivery`);
    assert.match(message.text, /Out with the courier/);
    assert.match(message.text, /Where: Rome/);
    assert.match(message.text, new RegExp(`http://localhost:\\d+/\\?track=${number}`));
    assert.match(message.text, /\/unsubscribe\?token=[\w-]+/);
  });

  it("include the one-click unsubscribe headers", async () => {
    const number = newShipment();
    await follower(number);
    await postUpdate(number);

    const [message] = await emailsAfterJobs();
    assert.match(message.headers["List-Unsubscribe"], /^<http:\/\/localhost:\d+\/api\/notifications\/unsubscribe\?token=[\w-]+>$/);
    assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  it("go to every customer who saved it, each with their own link", async () => {
    const number = newShipment();
    const first = await follower(number);
    const second = await follower(number);
    await postUpdate(number);

    const messages = await emailsAfterJobs();
    assert.deepEqual(messages.map((m) => m.to).sort(), [first.email, second.email].sort());
    assert.notEqual(unsubscribeToken(messages[0]), unsubscribeToken(messages[1]));
  });

  it("aren't sent to customers who didn't save the shipment", async () => {
    const number = newShipment();
    await follower(newShipment());
    await postUpdate(number);
    assert.equal((await emailsAfterJobs()).length, 0);
  });

  it("aren't sent to an unconfirmed email address", async () => {
    const number = newShipment();
    await follower(number, { confirmed: false });
    await postUpdate(number);
    assert.equal((await emailsAfterJobs()).length, 0);
  });

  it("aren't sent to a customer who turned them off", async () => {
    const number = newShipment();
    const { client } = await follower(number);
    await client("PUT", PREFERENCES, { shipmentUpdates: false });
    await postUpdate(number);
    assert.equal((await emailsAfterJobs()).length, 0);
  });

  it("show the status at the time of each update", async () => {
    const number = newShipment();
    await follower(number);
    await postUpdate(number, { ...UPDATE, status: "In Transit" });
    await postUpdate(number, { ...UPDATE, status: "Delivered" });

    const subjects = (await emailsAfterJobs()).map((m) => m.subject).sort();
    assert.deepEqual(subjects, [`${number}: Delivered`, `${number}: In Transit`]);
  });

  it("aren't sent if the shipment is deleted before the job runs", async () => {
    const number = newShipment();
    await follower(number);
    await postUpdate(number);
    await admin("DELETE", `/api/admin/shipments/${number}`);
    assert.equal((await emailsAfterJobs()).length, 0);

    // Nothing to send is a normal outcome, not an error to keep retrying.
    const job = db.prepare("SELECT status FROM jobs WHERE type = 'notify-shipment-update' ORDER BY id DESC LIMIT 1").get();
    assert.equal(job.status, "done");
  });

  it("aren't sent if the update is removed from the history before the job runs", async () => {
    const number = newShipment();
    await follower(number);
    const posted = await postUpdate(number);
    const entryId = posted.json.shipment.events.at(-1).id;
    assert.equal((await admin("DELETE", `/api/admin/shipments/${number}/events/${entryId}`)).status, 200);

    assert.equal((await emailsAfterJobs()).length, 0);
  });

  it("aren't sent for a failed update", async () => {
    const number = newShipment();
    await follower(number);
    assert.equal((await postUpdate(number, { ...UPDATE, status: "Teleported" })).status, 400);
    assert.equal((await emailsAfterJobs()).length, 0);
  });

  it("leave no private links in the database once sent", async () => {
    const number = newShipment();
    await follower(number);
    await postUpdate(number);
    const [message] = await emailsAfterJobs();

    const rows = db.prepare("SELECT payload FROM jobs").all();
    assert.ok(rows.every((row) => !row.payload.includes(unsubscribeToken(message))));
  });
});

describe("turning update emails on and off", () => {
  it("is on by default", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, true);
  });

  it("can be turned off and on again", async () => {
    const { client } = await createLoggedInUser();
    assert.deepEqual((await client("PUT", PREFERENCES, { shipmentUpdates: false })).json, { shipmentUpdates: false });
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, false);
    await client("PUT", PREFERENCES, { shipmentUpdates: true });
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, true);
  });

  it("only changes your own setting", async () => {
    const { client } = await createLoggedInUser();
    const { client: other } = await createLoggedInUser();
    await client("PUT", PREFERENCES, { shipmentUpdates: false });
    assert.equal((await other("GET", ME)).json.user.notifyShipmentUpdates, true);
  });

  it("needs a login", async () => {
    assert.equal((await createClient()("PUT", PREFERENCES, { shipmentUpdates: false })).status, 401);
  });

  for (const value of ["false", 0, null, undefined]) {
    it(`rejects ${JSON.stringify(value)}`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client("PUT", PREFERENCES, { shipmentUpdates: value })).status, 400);
    });
  }
});

describe("unsubscribing from an email", () => {
  async function tokenFromAnUpdate() {
    const number = newShipment();
    const user = await follower(number);
    await postUpdate(number);
    const [message] = await emailsAfterJobs();
    return { ...user, token: unsubscribeToken(message) };
  }

  it("works in one click from an email app", async () => {
    const { client, token } = await tokenFromAnUpdate();
    const response = await createClient()("POST", `${UNSUBSCRIBE}?token=${token}`, undefined, {
      rawBody: "List-Unsubscribe=One-Click",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(response.status, 200);
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, false);
  });

  it("works from the unsubscribe page", async () => {
    const { client, token } = await tokenFromAnUpdate();
    assert.equal((await createClient()("POST", UNSUBSCRIBE, { token })).status, 200);
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, false);
  });

  it("only affects the person the email was sent to", async () => {
    const { token } = await tokenFromAnUpdate();
    const { client: other } = await createLoggedInUser();
    await createClient()("POST", UNSUBSCRIBE, { token });
    assert.equal((await other("GET", ME)).json.user.notifyShipmentUpdates, true);
  });

  it("keeps the same link working for later emails", async () => {
    const number = newShipment();
    const { client } = await follower(number);
    await postUpdate(number);
    const [first] = await emailsAfterJobs();
    sentEmails.length = 0;
    await postUpdate(number);
    const [second] = await emailsAfterJobs();

    assert.equal(unsubscribeToken(first), unsubscribeToken(second));
    await createClient()("POST", UNSUBSCRIBE, { token: unsubscribeToken(first) });
    assert.equal((await client("GET", ME)).json.user.notifyShipmentUpdates, false);
  });

  for (const [problem, token] of [["a made-up token", "nope"], ["no token", undefined], ["the wrong type", ["a"]]]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await createClient()("POST", UNSUBSCRIBE, { token })).status, 400);
    });
  }

  it("is limited per address", async () => {
    for (let i = 0; i < 30; i += 1) await createClient()("POST", UNSUBSCRIBE, { token: "nope" });
    assert.equal((await createClient()("POST", UNSUBSCRIBE, { token: "nope" })).status, 429);
  });
});
