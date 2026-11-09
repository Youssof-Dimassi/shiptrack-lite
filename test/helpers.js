// Shared test tools.
//
// Every test file gets its own empty database that exists only in memory, so
// tests can never touch your real shiptrack.db.
// (Node runs each test file separately, so they can't affect each other.)

import { once } from "node:events";
import { after, beforeEach } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.EMAIL_TRANSPORT ??= "memory"; // keeps test emails from being sent or printed

// These are imported here, after the line above, so they use the test database.
const { app } = await import("../src/app.js");
const { clearAllRateLimits } = await import("../src/models/rateLimits.js");
const { setUserRole } = await import("../src/models/users.js");

// Port 0 asks the computer for any free port.
const server = app.listen(0);
await once(server, "listening");
const baseUrl = `http://localhost:${server.address().port}`;

after(() => {
  server.closeAllConnections();
  server.close();
});

// Tests share one address, so their attempts mustn't add up.
beforeEach(() => clearAllRateLimits());

export const PASSWORD = "correct-horse-battery";

let emailCounter = 0;

export function uniqueEmail() {
  emailCounter += 1;
  return `user${emailCounter}@example.com`;
}

// A small pretend browser: it remembers its login cookie between requests.
export function createClient() {
  let cookie = "";

  return async function request(method, path, body, options = {}) {
    const headers = { ...options.headers };
    if (body !== undefined || options.rawBody !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: options.rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) cookie = setCookies[0].split(";")[0];

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not every response is JSON, e.g. HTML pages.
    }

    return { status: response.status, headers: response.headers, text, json, setCookies };
  };
}

// Returns a logged-in client and the account's email.
export async function createLoggedInUser() {
  const client = createClient();
  const email = uniqueEmail();
  const response = await client("POST", "/api/auth/register", { name: "Test User", email, password: PASSWORD });
  if (response.status !== 201) throw new Error(`Could not create test user: ${response.text}`);
  return { client, email };
}

export async function createAdmin() {
  const user = await createLoggedInUser();
  setUserRole(user.email, "admin");
  return user;
}
