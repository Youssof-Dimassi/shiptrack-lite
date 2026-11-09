import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { PASSWORD, createClient, createLoggedInUser, uniqueEmail } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { sentEmails } = await import("../src/email/mailer.js");
const { chooseEmailTransport } = await import("../src/config.js");

const AUTH = "/api/auth";
const LOGIN = `${AUTH}/login`;
const ME = `${AUTH}/me`;
const FORGOT = `${AUTH}/forgot-password`;
const RESET = `${AUTH}/reset-password`;
const CONFIRM = `${AUTH}/confirm-email`;
const RESEND = `${AUTH}/resend-confirmation`;
const NEW_PASSWORD = "a-brand-new-password";

beforeEach(() => {
  sentEmails.length = 0;
});

function emailsTo(address) {
  return sentEmails.filter((email) => email.to === address);
}

function tokenIn(email) {
  return email.text.match(/token=([\w-]+)/)[1];
}

function lastToken(address) {
  const emails = emailsTo(address);
  return tokenIn(emails[emails.length - 1]);
}

function expireAllTokens() {
  db.exec("UPDATE account_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");
}

function post(path, body, options) {
  return createClient()("POST", path, body, options);
}

async function requestResetToken(email) {
  await post(FORGOT, { email });
  return lastToken(email);
}

function login(email, password) {
  return post(LOGIN, { email, password });
}

describe("confirming an email address", () => {
  it("sends a confirmation link when signing up", async () => {
    const { email } = await createLoggedInUser();
    const [message] = emailsTo(email);
    assert.match(message.subject, /Confirm/);
    assert.match(message.text, /^[\s\S]*http:\/\/localhost:\d+\/confirm-email\?token=[\w-]{43}/);
  });

  it("never puts the password in an email", async () => {
    const { email } = await createLoggedInUser();
    assert.doesNotMatch(emailsTo(email)[0].text, new RegExp(PASSWORD));
  });

  it("starts unconfirmed but lets the customer log in", async () => {
    const { client, email } = await createLoggedInUser();
    assert.equal((await client("GET", ME)).json.user.emailConfirmed, false);
    const response = await login(email, PASSWORD);
    assert.equal(response.status, 200);
    assert.equal(response.json.user.emailConfirmed, false);
  });

  it("confirms with the link's token", async () => {
    const { client, email } = await createLoggedInUser();
    assert.equal((await post(CONFIRM, { token: lastToken(email) })).status, 200);
    assert.equal((await client("GET", ME)).json.user.emailConfirmed, true);
    assert.equal((await login(email, PASSWORD)).json.user.emailConfirmed, true);
  });

  it("only confirms the account the link was sent to", async () => {
    const { email } = await createLoggedInUser();
    const { client: other } = await createLoggedInUser();
    await post(CONFIRM, { token: lastToken(email) });
    assert.equal((await other("GET", ME)).json.user.emailConfirmed, false);
  });

  it("works only once", async () => {
    const { email } = await createLoggedInUser();
    const token = lastToken(email);
    assert.equal((await post(CONFIRM, { token })).status, 200);
    assert.equal((await post(CONFIRM, { token })).status, 400);
  });

  it("rejects an expired link", async () => {
    const { client, email } = await createLoggedInUser();
    const token = lastToken(email);
    expireAllTokens();
    assert.equal((await post(CONFIRM, { token })).status, 400);
    assert.equal((await client("GET", ME)).json.user.emailConfirmed, false);
  });

  for (const [problem, token] of [["a made-up token", "nope"], ["no token", undefined], ["the wrong type", ["a"]]]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await post(CONFIRM, { token })).status, 400);
    });
  }

  it("doesn't accept a password reset token", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    assert.equal((await post(CONFIRM, { token })).status, 400);
  });

  it("is limited per address", async () => {
    for (let i = 0; i < 20; i += 1) assert.equal((await post(CONFIRM, { token: "nope" })).status, 400);
    assert.equal((await post(CONFIRM, { token: "nope" })).status, 429);
  });

  it("keeps the original confirmation time", async () => {
    const { email } = await createLoggedInUser();
    await post(CONFIRM, { token: lastToken(email) });
    const confirmedAt = () => db.prepare("SELECT email_confirmed_at FROM users WHERE email = ?").get(email).email_confirmed_at;
    const first = confirmedAt();
    assert.ok(first);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });

    assert.equal(confirmedAt(), first);
  });

  it("stores only a hash of the token", async () => {
    const { email } = await createLoggedInUser();
    const token = lastToken(email);
    const match = db.prepare("SELECT COUNT(*) AS count FROM account_tokens WHERE token_hash = ?").get(token);
    assert.equal(match.count, 0);
  });
});

describe("resending the confirmation", () => {
  it("needs a login", async () => {
    assert.equal((await post(RESEND)).status, 401);
  });

  it("sends a new link and cancels the old one", async () => {
    const { client, email } = await createLoggedInUser();
    const oldToken = lastToken(email);
    assert.equal((await client("POST", RESEND)).status, 200);
    const newToken = lastToken(email);

    assert.notEqual(newToken, oldToken);
    assert.equal((await post(CONFIRM, { token: oldToken })).status, 400);
    assert.equal((await post(CONFIRM, { token: newToken })).status, 200);
  });

  it("sends nothing if already confirmed", async () => {
    const { client, email } = await createLoggedInUser();
    await post(CONFIRM, { token: lastToken(email) });
    const before = emailsTo(email).length;
    assert.equal((await client("POST", RESEND)).status, 200);
    assert.equal(emailsTo(email).length, before);
  });

  it("is limited per account", async () => {
    const { client } = await createLoggedInUser();
    for (let i = 0; i < 5; i += 1) assert.equal((await client("POST", RESEND)).status, 200);
    const blocked = await client("POST", RESEND);
    assert.equal(blocked.status, 429);
  });
});

describe("asking to reset a password", () => {
  it("emails a reset link", async () => {
    const { email } = await createLoggedInUser();
    sentEmails.length = 0;
    assert.equal((await post(FORGOT, { email })).status, 200);
    const [message] = emailsTo(email);
    assert.match(message.subject, /Reset/);
    assert.match(message.text, /\/reset-password\?token=[\w-]{43}/);
  });

  it("finds the account regardless of email case and spaces", async () => {
    const { email } = await createLoggedInUser();
    sentEmails.length = 0;
    await post(FORGOT, { email: `  ${email.toUpperCase()} ` });
    assert.equal(emailsTo(email).length, 1);
  });

  it("gives the same answer whether or not the account exists", async () => {
    const { email } = await createLoggedInUser();
    const real = await post(FORGOT, { email });
    const fake = await post(FORGOT, { email: uniqueEmail() });
    assert.equal(real.status, fake.status);
    assert.equal(real.text, fake.text);
  });

  it("sends nothing for an unknown email", async () => {
    await post(FORGOT, { email: uniqueEmail() });
    assert.equal(sentEmails.length, 0);
  });

  for (const [problem, email] of [["a missing email", undefined], ["the wrong type", ["a@b.co"]]]) {
    it(`handles ${problem}`, async () => {
      assert.equal((await post(FORGOT, { email })).status, 200);
      assert.equal(sentEmails.length, 0);
    });
  }

  it("uses the configured site address, ignoring request headers", async () => {
    const { email } = await createLoggedInUser();
    sentEmails.length = 0;
    await post(FORGOT, { email }, { headers: { Host: "evil.example", "X-Forwarded-Host": "evil.example" } });
    assert.doesNotMatch(emailsTo(email)[0].text, /evil\.example/);
    assert.match(emailsTo(email)[0].text, /http:\/\/localhost/);
  });

  it("can't be used to flood someone's inbox, and stays silent about it", async () => {
    const { email } = await createLoggedInUser();
    sentEmails.length = 0;
    const responses = [];
    for (let i = 0; i < 5; i += 1) responses.push(await post(FORGOT, { email }));
    assert.equal(emailsTo(email).length, 3);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(responses[4].text, responses[0].text);
  });

  it("is limited per address", async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await post(FORGOT, { email: uniqueEmail() })).status, 200);
    assert.equal((await post(FORGOT, { email: uniqueEmail() })).status, 429);
  });

  it("a new request cancels the earlier link", async () => {
    const { email } = await createLoggedInUser();
    const oldToken = await requestResetToken(email);
    const newToken = await requestResetToken(email);
    assert.equal((await post(RESET, { token: oldToken, password: NEW_PASSWORD })).status, 400);
    assert.equal((await post(RESET, { token: newToken, password: NEW_PASSWORD })).status, 200);
  });
});

describe("choosing a new password", () => {
  it("replaces the old password", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);

    assert.equal((await post(RESET, { token, password: NEW_PASSWORD })).status, 200);

    assert.equal((await login(email, PASSWORD)).status, 401);
    assert.equal((await login(email, NEW_PASSWORD)).status, 200);
  });

  it("stores a hash, not the password", async () => {
    const { email } = await createLoggedInUser();
    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });
    const { password_hash: stored } = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(email);
    assert.match(stored, /^scrypt\$/);
    assert.ok(!stored.includes(NEW_PASSWORD));
  });

  it("only changes the account the link was sent to", async () => {
    const { email } = await createLoggedInUser();
    const { email: otherEmail } = await createLoggedInUser();
    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });
    assert.equal((await login(otherEmail, PASSWORD)).status, 200);
  });

  it("logs out every device", async () => {
    const { client, email } = await createLoggedInUser();
    const secondDevice = createClient();
    await secondDevice("POST", LOGIN, { email, password: PASSWORD });

    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });

    assert.equal((await client("GET", ME)).status, 401);
    assert.equal((await secondDevice("GET", ME)).status, 401);
  });

  it("leaves other people logged in", async () => {
    const { email } = await createLoggedInUser();
    const { client: other } = await createLoggedInUser();
    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });
    assert.equal((await other("GET", ME)).status, 200);
  });

  it("also confirms the email", async () => {
    const { email } = await createLoggedInUser();
    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });
    assert.equal((await login(email, NEW_PASSWORD)).json.user.emailConfirmed, true);
  });

  it("clears a login block from the same address", async () => {
    const { email } = await createLoggedInUser();
    for (let i = 0; i < 5; i += 1) await login(email, "wrong-password");
    assert.equal((await login(email, PASSWORD)).status, 429);

    await post(RESET, { token: await requestResetToken(email), password: NEW_PASSWORD });

    assert.equal((await login(email, NEW_PASSWORD)).status, 200);
  });

  it("works only once", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    await post(RESET, { token, password: NEW_PASSWORD });
    assert.equal((await post(RESET, { token, password: "yet-another-password" })).status, 400);
    assert.equal((await login(email, NEW_PASSWORD)).status, 200);
  });

  it("works only once even when used twice at the same moment", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    const responses = await Promise.all([
      post(RESET, { token, password: "first-new-password" }),
      post(RESET, { token, password: "second-new-password" }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  });

  it("rejects an expired link", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    expireAllTokens();
    assert.equal((await post(RESET, { token, password: NEW_PASSWORD })).status, 400);
    assert.equal((await login(email, PASSWORD)).status, 200);
  });

  it("a password that's too short doesn't use up the link", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    assert.equal((await post(RESET, { token, password: "short" })).status, 400);
    assert.equal((await post(RESET, { token, password: NEW_PASSWORD })).status, 200);
  });

  it("rejects a password that's too long", async () => {
    const { email } = await createLoggedInUser();
    const token = await requestResetToken(email);
    assert.equal((await post(RESET, { token, password: "x".repeat(129) })).status, 400);
  });

  for (const [problem, token] of [["a made-up token", "nope"], ["no token", undefined], ["the wrong type", { a: 1 }]]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await post(RESET, { token, password: NEW_PASSWORD })).status, 400);
    });
  }

  it("doesn't accept a confirmation token", async () => {
    const { email } = await createLoggedInUser();
    assert.equal((await post(RESET, { token: lastToken(email), password: NEW_PASSWORD })).status, 400);
    assert.equal((await login(email, PASSWORD)).status, 200);
  });

  it("is limited per address", async () => {
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await post(RESET, { token: "nope", password: NEW_PASSWORD })).status, 400);
    }
    assert.equal((await post(RESET, { token: "nope", password: NEW_PASSWORD })).status, 429);
  });
});

describe("choosing how email is sent", () => {
  it("prints to the terminal while developing", () => {
    assert.equal(chooseEmailTransport({}), "console");
  });

  it("uses SMTP when it's configured", () => {
    assert.equal(chooseEmailTransport({ SMTP_URL: "smtp://mail" }), "smtp");
    assert.equal(chooseEmailTransport({ SMTP_URL: "smtp://mail", NODE_ENV: "production" }), "smtp");
  });

  it("never prints private links in production", () => {
    assert.equal(chooseEmailTransport({ NODE_ENV: "production" }), "disabled");
  });
});
