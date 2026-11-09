import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PASSWORD, createClient, createLoggedInUser, uniqueEmail } from "./helpers.js";

const { db } = await import("../src/db/database.js");

const REGISTER = "/api/auth/register";
const LOGIN = "/api/auth/login";
const LOGOUT = "/api/auth/logout";
const ME = "/api/auth/me";

describe("signing up", () => {
  it("creates an account and logs in", async () => {
    const client = createClient();
    const email = uniqueEmail();
    const response = await client("POST", REGISTER, { name: "Sam", email, password: PASSWORD });
    assert.equal(response.status, 201);
    assert.equal(response.json.user.email, email);
    assert.equal((await client("GET", ME)).status, 200);
  });

  it("protects the login cookie", async () => {
    const response = await createClient()("POST", REGISTER, { name: "Sam", email: uniqueEmail(), password: PASSWORD });
    assert.match(response.setCookies[0], /HttpOnly/i);
    assert.match(response.setCookies[0], /SameSite=Lax/i);
  });

  it("stores emails in lowercase", async () => {
    const response = await createClient()("POST", REGISTER, { name: "Sam", email: "MixedCase@Example.com", password: PASSWORD });
    assert.equal(response.json.user.email, "mixedcase@example.com");
  });

  it("can't be used to become an admin", async () => {
    const client = createClient();
    const response = await client("POST", REGISTER, { name: "Sam", email: uniqueEmail(), password: PASSWORD, role: "admin" });
    assert.equal(response.json.user.role, "customer");
    assert.equal((await client("GET", ME)).json.user.role, "customer");
  });

  for (const [problem, change] of [
    ["a missing name", { name: "" }],
    ["a very long name", { name: "x".repeat(101) }],
    ["an invalid email", { email: "not-an-email" }],
    ["a short password", { password: "short" }],
    ["a very long password", { password: "x".repeat(129) }],
    ["fields of the wrong type", { name: ["a"], email: { a: 1 }, password: 12345678 }],
  ]) {
    it(`rejects ${problem}`, async () => {
      const body = { name: "Sam", email: uniqueEmail(), password: PASSWORD, ...change };
      assert.equal((await createClient()("POST", REGISTER, body)).status, 400);
    });
  }

  it("rejects an email that's already registered", async () => {
    const { email } = await createLoggedInUser();
    const response = await createClient()("POST", REGISTER, { name: "Copy", email: email.toUpperCase(), password: PASSWORD });
    assert.equal(response.status, 409);
  });
});

describe("logging in and out", () => {
  it("logs in with the right password, ignoring email case and spaces", async () => {
    const { email } = await createLoggedInUser();
    const client = createClient();
    const response = await client("POST", LOGIN, { email: `  ${email.toUpperCase()} `, password: PASSWORD });
    assert.equal(response.status, 200);
    assert.equal((await client("GET", ME)).json.user.email, email);
  });

  it("never reveals whether the email or the password was wrong", async () => {
    const { email } = await createLoggedInUser();
    const wrongPassword = await createClient()("POST", LOGIN, { email, password: "wrong-password" });
    const unknownEmail = await createClient()("POST", LOGIN, { email: uniqueEmail(), password: "wrong-password" });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.text, unknownEmail.text);
  });

  it("never sends the password hash to the browser", async () => {
    const { client, email } = await createLoggedInUser();
    const me = await client("GET", ME);
    const login = await createClient()("POST", LOGIN, { email, password: PASSWORD });
    assert.doesNotMatch(me.text, /password|scrypt/i);
    assert.doesNotMatch(login.text, /password|scrypt/i);
  });

  it("logging out really ends the session", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("POST", LOGOUT)).status, 204);
    assert.equal((await client("GET", ME)).status, 401);
  });

  it("a session stops working once it has expired", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("GET", ME)).status, 200);

    db.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");

    assert.equal((await client("GET", ME)).status, 401);
  });

  // An instant answer would reveal that the email has no account. The real
  // gap is about 25 times, so this margin is safe even on a busy computer.
  it("takes about as long for an unknown email as for a wrong password", async () => {
    const { email } = await createLoggedInUser();

    async function medianTime(makeEmail) {
      const times = [];
      for (let i = 0; i < 3; i += 1) {
        const start = performance.now();
        await createClient()("POST", LOGIN, { email: makeEmail(), password: "wrong-password" });
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[1];
    }

    const wrongPassword = await medianTime(() => email);
    const unknownEmail = await medianTime(uniqueEmail);
    assert.ok(
      unknownEmail > wrongPassword * 0.2,
      `unknown email took ${unknownEmail.toFixed(1)}ms, wrong password took ${wrongPassword.toFixed(1)}ms`,
    );
  });

  it("a stolen cookie stops working after logout", async () => {
    const email = uniqueEmail();
    const register = await createClient()("POST", REGISTER, { name: "Sam", email, password: PASSWORD });
    const cookie = register.setCookies[0].split(";")[0];

    const browser = createClient();
    assert.equal((await browser("GET", ME, undefined, { headers: { Cookie: cookie } })).status, 200);
    await browser("POST", LOGOUT, undefined, { headers: { Cookie: cookie } });
    assert.equal((await createClient()("GET", ME, undefined, { headers: { Cookie: cookie } })).status, 401);
  });
});

describe("requests that aren't logged in or are malformed", () => {
  it("answers 401 without a cookie", async () => {
    assert.equal((await createClient()("GET", ME)).status, 401);
  });

  for (const cookie of ["sid=made-up-token", "sid=%E0%A4%A", "sid=", "other=value"]) {
    it(`ignores the bad cookie ${cookie}`, async () => {
      assert.equal((await createClient()("GET", ME, undefined, { headers: { Cookie: cookie } })).status, 401);
    });
  }

  it("answers 400 to broken JSON", async () => {
    const response = await createClient()("POST", LOGIN, undefined, { rawBody: "{bad json" });
    assert.equal(response.status, 400);
  });

  it("refuses a request body that's too large", async () => {
    const response = await createClient()("POST", LOGIN, { email: "a@b.co", password: "x".repeat(20000) });
    assert.equal(response.status, 413);
  });

  it("doesn't crash on fields of the wrong type", async () => {
    assert.equal((await createClient()("POST", LOGIN, { email: ["a"], password: { x: 1 } })).status, 401);
  });
});
