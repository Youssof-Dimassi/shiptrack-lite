// A broken mail server must never break the website.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.EMAIL_TRANSPORT = "";
process.env.SMTP_URL = "smtp://127.0.0.1:1"; // nothing is listening here

const { PASSWORD, createClient, drainJobs, uniqueEmail } = await import("./helpers.js");
const { db } = await import("../src/db/database.js");

describe("when the mail server is down", () => {
  it("still lets people sign up and ask for a reset", async () => {
    const email = uniqueEmail();
    const client = createClient();

    assert.equal((await client("POST", "/api/auth/register", { name: "Sam", email, password: PASSWORD })).status, 201);
    assert.equal((await client("GET", "/api/auth/me")).status, 200);
    assert.equal((await client("POST", "/api/auth/forgot-password", { email })).status, 200);

    // The failed emails wait in the queue to be tried again, with the reason kept.
    await drainJobs();
    const jobs = db.prepare("SELECT status, attempts, last_error FROM jobs WHERE type = 'send-email'").all();
    assert.equal(jobs.length, 2);
    for (const job of jobs) {
      assert.equal(job.status, "pending");
      assert.equal(job.attempts, 1);
      assert.ok(job.last_error);
    }
    assert.equal((await client("GET", "/api/health")).status, 200);
  });
});
