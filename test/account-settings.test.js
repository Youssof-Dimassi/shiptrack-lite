import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { PASSWORD, createAdmin, createClient, createLoggedInUser, drainJobs, uniqueEmail } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { sentEmails } = await import("../src/email/mailer.js");

const ME = "/api/auth/me";
const LOGIN = "/api/auth/login";
const PROFILE = "/api/account/profile";
const PASSWORD_URL = "/api/account/password";
const EMAIL = "/api/account/email";
const CONFIRM_CHANGE = "/api/account/confirm-email-change";
const ACCOUNT = "/api/account";
const NEW_PASSWORD = "a-brand-new-password";

beforeEach(async () => {
  await drainJobs();
  sentEmails.length = 0;
});

async function emailsTo(address) {
  await drainJobs();
  return sentEmails.filter((email) => email.to === address);
}

async function changeToken(address) {
  const [email] = (await emailsTo(address)).filter((e) => e.subject.startsWith("Confirm your new"));
  return email.text.match(/confirm-email-change\?token=([\w-]+)/)[1];
}

function login(email, password) {
  return createClient()("POST", LOGIN, { email, password });
}

function me(client) {
  return client("GET", ME).then((response) => response.json.user);
}

describe("who can use account settings", () => {
  for (const [method, url, body] of [
    ["PUT", PROFILE, { name: "x" }],
    ["PUT", PASSWORD_URL, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }],
    ["PUT", EMAIL, { email: "x@example.com", password: PASSWORD }],
    ["DELETE", ACCOUNT, { password: PASSWORD }],
  ]) {
    it(`${method} ${url} answers 401 when not logged in`, async () => {
      assert.equal((await createClient()(method, url, body)).status, 401);
    });
  }
});

describe("changing your name", () => {
  it("saves the new name", async () => {
    const { client } = await createLoggedInUser();
    const response = await client("PUT", PROFILE, { name: "  Samira Haddad " });
    assert.equal(response.status, 200);
    assert.equal(response.json.user.name, "Samira Haddad");
    assert.equal((await me(client)).name, "Samira Haddad");
  });

  for (const [problem, name] of [["an empty name", " "], ["a very long name", "x".repeat(101)], ["the wrong type", ["x"]]]) {
    it(`rejects ${problem}`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client("PUT", PROFILE, { name })).status, 400);
      assert.equal((await me(client)).name, "Test User");
    });
  }
});

describe("changing your password", () => {
  it("needs the current password", async () => {
    const { client, email } = await createLoggedInUser();
    const response = await client("PUT", PASSWORD_URL, { currentPassword: "wrong-password", newPassword: NEW_PASSWORD });
    assert.equal(response.status, 400);
    assert.equal((await login(email, PASSWORD)).status, 200);
  });

  it("changes the password, keeps this browser logged in, and logs out others", async () => {
    const { client, email } = await createLoggedInUser();
    const otherDevice = createClient();
    await otherDevice("POST", LOGIN, { email, password: PASSWORD });

    assert.equal((await client("PUT", PASSWORD_URL, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status, 200);

    assert.equal((await client("GET", ME)).status, 200);
    assert.equal((await otherDevice("GET", ME)).status, 401);
    assert.equal((await login(email, PASSWORD)).status, 401);
    assert.equal((await login(email, NEW_PASSWORD)).status, 200);
  });

  it("emails a notice to the account's address", async () => {
    const { client, email } = await createLoggedInUser();
    await client("PUT", PASSWORD_URL, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    const notice = (await emailsTo(email)).find((e) => /password was changed/.test(e.subject));
    assert.ok(notice, "no password notice was sent");
    assert.doesNotMatch(notice.text, new RegExp(NEW_PASSWORD));
  });

  for (const [problem, newPassword] of [["too short", "short"], ["too long", "x".repeat(129)], ["the wrong type", 12345678]]) {
    it(`rejects a new password that is ${problem}`, async () => {
      const { client, email } = await createLoggedInUser();
      assert.equal((await client("PUT", PASSWORD_URL, { currentPassword: PASSWORD, newPassword })).status, 400);
      assert.equal((await login(email, PASSWORD)).status, 200);
    });
  }

  it("blocks guessing the current password", async () => {
    const { client } = await createLoggedInUser();
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await client("PUT", PASSWORD_URL, { currentPassword: "wrong-password", newPassword: NEW_PASSWORD })).status, 400);
    }
    const blocked = await client("PUT", PASSWORD_URL, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.equal(blocked.status, 429);
  });

  it("doesn't count correct passwords toward the limit", async () => {
    const { client } = await createLoggedInUser();
    let current = PASSWORD;
    for (let i = 0; i < 6; i += 1) {
      const next = `new-password-number-${i}`;
      assert.equal((await client("PUT", PASSWORD_URL, { currentPassword: current, newPassword: next })).status, 200);
      current = next;
    }
  });
});

describe("changing your email", () => {
  it("waits for the new address to be confirmed", async () => {
    const { client, email } = await createLoggedInUser();
    const newEmail = uniqueEmail();

    const response = await client("PUT", EMAIL, { email: newEmail.toUpperCase(), password: PASSWORD });
    assert.equal(response.status, 200);

    const user = await me(client);
    assert.equal(user.email, email);
    assert.equal(user.pendingEmail, newEmail);
    assert.equal((await login(email, PASSWORD)).status, 200);
    assert.equal((await login(newEmail, PASSWORD)).status, 401);
  });

  it("sends the link to the new address, and switches when it's opened", async () => {
    const { client, email } = await createLoggedInUser();
    const newEmail = uniqueEmail();
    await client("PUT", EMAIL, { email: newEmail, password: PASSWORD });

    const result = await createClient()("POST", CONFIRM_CHANGE, { token: await changeToken(newEmail) });
    assert.equal(result.status, 200);

    const user = await me(client);
    assert.equal(user.email, newEmail);
    assert.equal(user.emailConfirmed, true);
    assert.equal(user.pendingEmail, null);
    assert.equal((await login(newEmail, PASSWORD)).status, 200);
    assert.equal((await login(email, PASSWORD)).status, 401);
  });

  it("records when the NEW address was confirmed, not the old one", async () => {
    const { client, email } = await createLoggedInUser();
    db.prepare("UPDATE users SET email_confirmed_at = '2020-01-01T00:00:00.000Z' WHERE email = ?").run(email);
    const newEmail = uniqueEmail();
    await client("PUT", EMAIL, { email: newEmail, password: PASSWORD });
    await createClient()("POST", CONFIRM_CHANGE, { token: await changeToken(newEmail) });

    const { email_confirmed_at: confirmedAt } = db.prepare("SELECT email_confirmed_at FROM users WHERE email = ?").get(newEmail);
    assert.ok(confirmedAt > "2026-01-01", `confirmed at ${confirmedAt}`);
  });

  it("tells the old address about the change", async () => {
    const { client, email } = await createLoggedInUser();
    const newEmail = uniqueEmail();
    await client("PUT", EMAIL, { email: newEmail, password: PASSWORD });
    await createClient()("POST", CONFIRM_CHANGE, { token: await changeToken(newEmail) });

    const notices = (await emailsTo(email)).filter((e) => e.subject.includes("email was changed"));
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, new RegExp(newEmail.replace(".", "\\.")));
  });

  it("needs the current password", async () => {
    const { client } = await createLoggedInUser();
    const newEmail = uniqueEmail();
    assert.equal((await client("PUT", EMAIL, { email: newEmail, password: "wrong-password" })).status, 400);
    assert.equal((await me(client)).pendingEmail, null);
    assert.equal((await emailsTo(newEmail)).length, 0);
  });

  it("rejects an address that's already used", async () => {
    const { client } = await createLoggedInUser();
    const { email: taken } = await createLoggedInUser();
    assert.equal((await client("PUT", EMAIL, { email: taken, password: PASSWORD })).status, 409);
  });

  it("rejects your current address", async () => {
    const { client, email } = await createLoggedInUser();
    assert.equal((await client("PUT", EMAIL, { email, password: PASSWORD })).status, 400);
  });

  for (const [problem, email] of [["an invalid address", "not-an-email"], ["the wrong type", ["a@b.co"]], ["a header injection", "a@b.co\r\nBcc: x@y.z"]]) {
    it(`rejects ${problem}`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client("PUT", EMAIL, { email, password: PASSWORD })).status, 400);
    });
  }

  it("fails safely if someone else takes the address before it's confirmed", async () => {
    const { client, email } = await createLoggedInUser();
    const newEmail = uniqueEmail();
    await client("PUT", EMAIL, { email: newEmail, password: PASSWORD });
    const token = await changeToken(newEmail);

    await createClient()("POST", "/api/auth/register", { name: "Quick", email: newEmail, password: PASSWORD });

    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token })).status, 409);
    assert.equal((await me(client)).email, email);
  });

  it("works only once, and a newer request cancels the older link", async () => {
    const { client } = await createLoggedInUser();
    const first = uniqueEmail();
    const second = uniqueEmail();
    await client("PUT", EMAIL, { email: first, password: PASSWORD });
    const firstToken = await changeToken(first);
    await client("PUT", EMAIL, { email: second, password: PASSWORD });
    const secondToken = await changeToken(second);

    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token: firstToken })).status, 400);
    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token: secondToken })).status, 200);
    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token: secondToken })).status, 400);
    assert.equal((await me(client)).email, second);
  });

  it("can't be confirmed with a sign-up confirmation link", async () => {
    const { client, email } = await createLoggedInUser();
    const signup = (await emailsTo(email)).find((e) => e.subject === "Confirm your ShipTrack Lite email");
    const signupToken = signup.text.match(/token=([\w-]+)/)[1];

    await client("PUT", EMAIL, { email: uniqueEmail(), password: PASSWORD });

    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token: signupToken })).status, 400);
    assert.equal((await me(client)).email, email);
  });

  it("rejects an expired link", async () => {
    const { client, email } = await createLoggedInUser();
    const newEmail = uniqueEmail();
    await client("PUT", EMAIL, { email: newEmail, password: PASSWORD });
    const token = await changeToken(newEmail);
    db.exec("UPDATE account_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");

    assert.equal((await createClient()("POST", CONFIRM_CHANGE, { token })).status, 400);
    assert.equal((await me(client)).email, email);
  });
});

describe("deleting your account", () => {
  it("needs your password", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("DELETE", ACCOUNT, { password: "wrong-password" })).status, 400);
    assert.equal((await client("GET", ME)).status, 200);
  });

  it("deletes the account and everything that belongs to it", async () => {
    const { client, email } = await createLoggedInUser();
    const { id } = await me(client);
    await client("POST", "/api/my-shipments", { trackingNumber: "ST10000001" });

    const response = await client("DELETE", ACCOUNT, { password: PASSWORD });
    assert.equal(response.status, 204);
    assert.match(response.setCookies[0], /sid=;/);

    assert.equal((await client("GET", ME)).status, 401);
    assert.equal((await login(email, PASSWORD)).status, 401);
    for (const table of ["users WHERE id", "sessions WHERE user_id", "saved_shipments WHERE user_id", "account_tokens WHERE user_id"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} = ?`).get(id).count, 0, table);
    }
  });

  it("leaves other people's accounts alone", async () => {
    const { client } = await createLoggedInUser();
    const { email: other } = await createLoggedInUser();
    await client("DELETE", ACCOUNT, { password: PASSWORD });
    assert.equal((await login(other, PASSWORD)).status, 200);
  });

  it("won't delete the only admin", async () => {
    db.exec("UPDATE users SET role = 'customer'");
    const { client } = await createAdmin();
    const response = await client("DELETE", ACCOUNT, { password: PASSWORD });
    assert.equal(response.status, 409);
    assert.equal((await client("GET", ME)).status, 200);
  });

  it("lets an admin delete their account when another admin remains", async () => {
    const { client } = await createAdmin();
    await createAdmin();
    assert.equal((await client("DELETE", ACCOUNT, { password: PASSWORD })).status, 204);
  });
});
