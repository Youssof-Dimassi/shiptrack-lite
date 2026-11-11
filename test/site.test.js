import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createAdmin, createClient, drainJobs } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { sentEmails } = await import("../src/email/mailer.js");

const visitor = createClient();
const CONTACT = "/api/contact";
const MESSAGE = { name: "Sam Visitor", email: "Sam@Example.com", message: "Where is my parcel ST10000001?" };

beforeEach(async () => {
  await drainJobs();
  sentEmails.length = 0;
});

function contactEmails() {
  return sentEmails.filter((email) => email.subject.startsWith("New message"));
}

describe("the numbers on the home page", () => {
  it("are real counts from the database", async () => {
    const counts = db.prepare(`
      SELECT (SELECT COUNT(*) FROM shipments) AS shipments,
             (SELECT COUNT(*) FROM shipment_events) AS updates,
             (SELECT COUNT(*) FROM shipments WHERE status = 'Delivered') AS delivered
    `).get();
    assert.deepEqual((await visitor("GET", "/api/stats")).json, { ...counts });
  });

  it("go up when shipments are created and delivered", async () => {
    const before = (await visitor("GET", "/api/stats")).json;
    const { client: admin } = await createAdmin();
    const created = await admin("POST", "/api/admin/shipments", { origin: "A", destination: "B", estimatedDelivery: "2026-12-01" });
    await admin("POST", `/api/admin/shipments/${created.json.shipment.trackingNumber}/events`, { status: "Delivered", location: "B", description: "Delivered" });

    const after = (await visitor("GET", "/api/stats")).json;
    assert.equal(after.shipments, before.shipments + 1);
    assert.equal(after.updates, before.updates + 2);
    assert.equal(after.delivered, before.delivered + 1);
  });

  it("reveal only totals", async () => {
    assert.deepEqual(Object.keys((await visitor("GET", "/api/stats")).json).sort(), ["delivered", "shipments", "updates"]);
  });
});

describe("the contact form", () => {
  it("emails the message to the team, with Reply going to the customer", async () => {
    const response = await createClient()("POST", CONTACT, MESSAGE);
    assert.equal(response.status, 200);
    assert.match(response.json.message, /Thanks/);
    assert.equal(contactEmails().length, 0, "sent in the background, not during the request");

    await drainJobs();
    const [email] = contactEmails();
    assert.equal(email.to, "support@shiptrack.example");
    assert.equal(email.replyTo, "sam@example.com");
    assert.match(email.text, /From: Sam Visitor <sam@example\.com>/);
    assert.match(email.text, /Where is my parcel ST10000001\?/);
  });

  it("silently drops messages from spam robots", async () => {
    const response = await createClient()("POST", CONTACT, { ...MESSAGE, website: "http://spam.example" });
    assert.equal(response.status, 200);
    assert.equal(response.json.message, (await createClient()("POST", CONTACT, MESSAGE)).json.message);
    await drainJobs();
    assert.equal(contactEmails().length, 1);
  });

  it("can't be used to add extra email headers", async () => {
    const response = await createClient()("POST", CONTACT, { ...MESSAGE, email: "a@b.co\r\nBcc: victim@example.com" });
    assert.equal(response.status, 400);
  });

  it("keeps the subject fixed, whatever the name says", async () => {
    await createClient()("POST", CONTACT, { ...MESSAGE, name: "Hi\r\nSubject: Hacked" });
    await drainJobs();
    assert.equal(contactEmails()[0].subject, "New message from the ShipTrack Lite contact form");
  });

  for (const [problem, change] of [
    ["a missing name", { name: "" }],
    ["a very long name", { name: "x".repeat(101) }],
    ["an invalid email", { email: "not-an-email" }],
    ["a message that's too short", { message: "Hi" }],
    ["a message that's too long", { message: "x".repeat(2001) }],
    ["fields of the wrong type", { name: ["a"], email: {}, message: 12345678901 }],
  ]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await createClient()("POST", CONTACT, { ...MESSAGE, ...change })).status, 400);
      await drainJobs();
      assert.equal(contactEmails().length, 0);
    });
  }

  it("is limited per address", async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await createClient()("POST", CONTACT, MESSAGE)).status, 200);
    assert.equal((await createClient()("POST", CONTACT, MESSAGE)).status, 429);
  });
});

describe("the business pages", () => {
  const PAGES = ["/about", "/contact", "/privacy", "/terms"];

  for (const path of PAGES) {
    it(`${path} exists`, async () => {
      assert.equal((await visitor("GET", path)).status, 200);
    });
  }

  it("every link in the footer and menu works", async () => {
    const { text } = await visitor("GET", "/");
    const links = [...text.matchAll(/<a [^>]*href="(\/[^"#]*)/g)].map((m) => m[1]);
    for (const link of new Set(links)) {
      assert.equal((await visitor("GET", link)).status, 200, `${link} is broken`);
    }
  });

  it("every page has a description and link preview details", async () => {
    for (const path of ["/", ...PAGES, "/login", "/register"]) {
      const { text } = await visitor("GET", path);
      assert.match(text, /<meta name="description" content="[^"]{20,}">/, path);
      assert.match(text, /<meta property="og:title" content="[^"]+">/, path);
    }
  });

  it("the home page has every section", async () => {
    const { text } = await visitor("GET", "/");
    for (const id of ["track", "how-it-works", "preview", "features", "stats-band", "faq"]) {
      assert.match(text, new RegExp(`id="${id}"`), id);
    }
    assert.ok((text.match(/<details>/g) ?? []).length >= 5, "FAQ answers open and close");
  });
});

describe("pages that don't exist", () => {
  it("get a friendly page with a way back, and status 404", async () => {
    const response = await visitor("GET", "/this-page-does-not-exist");
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(response.text, /We couldn't find that page/);
    assert.match(response.text, /href="\/"/);
    assert.match(response.text, /class="site-footer"/);
  });

  it("API addresses still answer in JSON", async () => {
    const response = await visitor("GET", "/api/nope");
    assert.equal(response.status, 404);
    assert.equal(response.json.error, "API route not found.");
  });

  it("the not-found page can't be opened as a normal page", async () => {
    assert.equal((await visitor("GET", "/_not-found")).status, 404);
  });
});

describe("search engines", () => {
  it("are asked not to list private pages", async () => {
    const { status, text } = await visitor("GET", "/robots.txt");
    assert.equal(status, 200);
    for (const path of ["/admin", "/api/", "/my-shipments"]) assert.match(text, new RegExp(`Disallow: ${path}`));
  });
});
