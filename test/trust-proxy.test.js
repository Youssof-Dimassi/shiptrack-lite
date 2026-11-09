// Behind a hosting provider's proxy, every request arrives from the proxy, so
// the visitor's real address must be read from the X-Forwarded-For header.
// This has its own file because the setting is read once, when the app starts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.TRUST_PROXY = "1";

const { createClient } = await import("./helpers.js");

function failLogin(ip) {
  return createClient()(
    "POST",
    "/api/auth/login",
    { email: "same@example.com", password: "wrong-password" },
    { headers: { "X-Forwarded-For": ip } },
  );
}

describe("running behind one proxy", () => {
  it("limits each visitor by their real address", async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await failLogin("203.0.113.1")).status, 401);
    assert.equal((await failLogin("203.0.113.1")).status, 429);
  });

  it("doesn't let one visitor's block affect another", async () => {
    for (let i = 0; i < 6; i += 1) await failLogin("203.0.113.2");
    assert.equal((await failLogin("203.0.113.3")).status, 401);
  });
});
