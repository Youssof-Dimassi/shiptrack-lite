import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PASSWORD, createClient, createLoggedInUser, uniqueEmail } from "./helpers.js";

const { consumeAttempt } = await import("../src/models/rateLimits.js");

const LOGIN = "/api/auth/login";
const REGISTER = "/api/auth/register";
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 30;
const REGISTER_LIMIT = 20;

function failLogin(email, options) {
  return createClient()("POST", LOGIN, { email, password: "wrong-password" }, options);
}

function succeedLogin(email) {
  return createClient()("POST", LOGIN, { email, password: PASSWORD });
}

async function failLoginTimes(times, email) {
  for (let i = 0; i < times; i += 1) {
    assert.equal((await failLogin(email)).status, 401);
  }
}

describe("guessing one account's password", () => {
  it("blocks the attempt after the limit and says when to retry", async () => {
    const { email } = await createLoggedInUser();
    await failLoginTimes(ACCOUNT_LIMIT, email);

    const blocked = await failLogin(email);
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /Too many attempts/);

    const retryAfter = Number(blocked.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 15 * 60, `Retry-After was ${retryAfter}`);
  });

  it("blocks even the correct password while the limit applies", async () => {
    const { email } = await createLoggedInUser();
    await failLoginTimes(ACCOUNT_LIMIT, email);
    assert.equal((await succeedLogin(email)).status, 429);
  });

  it("treats different spellings of an email as the same account", async () => {
    const { email } = await createLoggedInUser();
    await failLoginTimes(ACCOUNT_LIMIT, email);
    assert.equal((await failLogin(`  ${email.toUpperCase()}  `)).status, 429);
  });

  it("can't be beaten by sending many guesses at once", async () => {
    const { email } = await createLoggedInUser();
    const responses = await Promise.all(Array.from({ length: 20 }, () => failLogin(email)));
    const statuses = responses.map((response) => response.status);

    assert.equal(statuses.filter((status) => status === 401).length, ACCOUNT_LIMIT);
    assert.equal(statuses.filter((status) => status === 429).length, 20 - ACCOUNT_LIMIT);
  });

  it("can't be beaten by faking the X-Forwarded-For header", async () => {
    const { email } = await createLoggedInUser();
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      await failLogin(email, { headers: { "X-Forwarded-For": `10.0.0.${i}` } });
    }
    const blocked = await failLogin(email, { headers: { "X-Forwarded-For": "10.0.0.99" } });
    assert.equal(blocked.status, 429);
  });

  it("gives away nothing about whether the email has an account", async () => {
    const { email: realEmail } = await createLoggedInUser();
    const fakeEmail = uniqueEmail();

    for (const email of [realEmail, fakeEmail]) await failLoginTimes(ACCOUNT_LIMIT, email);

    const real = await failLogin(realEmail);
    const fake = await failLogin(fakeEmail);
    assert.equal(real.status, 429);
    assert.equal(fake.status, 429);
    assert.equal(real.json.error, fake.json.error);
  });
});

describe("what a limit must not affect", () => {
  it("leaves other accounts working", async () => {
    const { email: lockedEmail } = await createLoggedInUser();
    const { email: otherEmail } = await createLoggedInUser();
    await failLoginTimes(ACCOUNT_LIMIT, lockedEmail);
    assert.equal((await succeedLogin(otherEmail)).status, 200);
  });

  it("forgets earlier failures after a successful log-in", async () => {
    const { email } = await createLoggedInUser();
    await failLoginTimes(ACCOUNT_LIMIT - 1, email);
    assert.equal((await succeedLogin(email)).status, 200);
    await failLoginTimes(ACCOUNT_LIMIT, email);
    assert.equal((await failLogin(email)).status, 429);
  });

  it("doesn't count successful log-ins against a shared address", async () => {
    const { email } = await createLoggedInUser();
    for (let i = 0; i < IP_LIMIT + 1; i += 1) {
      assert.equal((await succeedLogin(email)).status, 200);
    }
    assert.equal((await failLogin(uniqueEmail())).status, 401);
  });
});

describe("trying passwords across many accounts", () => {
  it("blocks the address after too many failures", async () => {
    for (let i = 0; i < IP_LIMIT; i += 1) {
      assert.equal((await failLogin(uniqueEmail())).status, 401);
    }
    assert.equal((await failLogin(uniqueEmail())).status, 429);
  });
});

describe("mass sign-ups", () => {
  it("blocks the address after the limit", async () => {
    const invalid = { name: "Sam", email: "not-an-email", password: PASSWORD };
    for (let i = 0; i < REGISTER_LIMIT; i += 1) {
      assert.equal((await createClient()("POST", REGISTER, invalid)).status, 400);
    }
    const blocked = await createClient()("POST", REGISTER, { name: "Sam", email: uniqueEmail(), password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });
});

// These pass in the time, so no test has to wait for 15 real minutes.
describe("the limit's time window", () => {
  const WINDOW = 60_000;
  const START = 1_000_000;
  let testNumber = 0;

  function rule() {
    testNumber += 1;
    return [{ key: `window-test-${testNumber}`, limit: 2, windowMs: WINDOW }];
  }

  it("allows attempts again once the window has passed", () => {
    const rules = rule();
    assert.equal(consumeAttempt(rules, START).allowed, true);
    assert.equal(consumeAttempt(rules, START + 1).allowed, true);
    assert.equal(consumeAttempt(rules, START + WINDOW - 1).allowed, false);
    assert.equal(consumeAttempt(rules, START + WINDOW).allowed, true);
  });

  it("gives a full new allowance after the window", () => {
    const rules = rule();
    consumeAttempt(rules, START);
    consumeAttempt(rules, START);
    assert.equal(consumeAttempt(rules, START + WINDOW).allowed, true);
    assert.equal(consumeAttempt(rules, START + WINDOW).allowed, true);
    assert.equal(consumeAttempt(rules, START + WINDOW).allowed, false);
  });

  it("reports the seconds left, rounded up", () => {
    const rules = rule();
    consumeAttempt(rules, START);
    consumeAttempt(rules, START);
    assert.equal(consumeAttempt(rules, START + 500).retryAfterSeconds, 60);
    assert.equal(consumeAttempt(rules, START + WINDOW - 1).retryAfterSeconds, 1);
  });

  it("doesn't let blocked attempts extend the block", () => {
    const rules = rule();
    consumeAttempt(rules, START);
    consumeAttempt(rules, START);
    for (let i = 1; i <= 50; i += 1) consumeAttempt(rules, START + i * 1000);
    assert.equal(consumeAttempt(rules, START + WINDOW).allowed, true);
  });

  it("counts nothing when any one rule blocks", () => {
    const shared = rule()[0];
    const blocking = { key: `blocking-${testNumber}`, limit: 1, windowMs: WINDOW };

    assert.equal(consumeAttempt([blocking], START).allowed, true);
    for (let i = 0; i < 5; i += 1) assert.equal(consumeAttempt([shared, blocking], START).allowed, false);

    assert.equal(consumeAttempt([shared], START).allowed, true);
    assert.equal(consumeAttempt([shared], START).allowed, true);
    assert.equal(consumeAttempt([shared], START).allowed, false);
  });
});
