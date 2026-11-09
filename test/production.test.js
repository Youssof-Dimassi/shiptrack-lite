// How the app behaves when deployed. It has its own file because these
// settings are read once, when the app starts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NODE_ENV = "production";

const { PASSWORD, createClient, uniqueEmail } = await import("./helpers.js");

const visitor = createClient();

describe("in production", () => {
  it("has no sample shipments", async () => {
    assert.equal((await visitor("GET", "/api/shipments/ST10000001")).status, 404);
  });

  it("turns demo mode off", async () => {
    assert.deepEqual((await visitor("GET", "/api/config")).json, { demoMode: false });
  });

  it("tells browsers to always use HTTPS", async () => {
    const { headers } = await visitor("GET", "/");
    assert.match(headers.get("strict-transport-security"), /max-age=\d+/);
    assert.match(headers.get("content-security-policy"), /upgrade-insecure-requests/);
  });

  it("only sends the login cookie over HTTPS", async () => {
    const response = await createClient()("POST", "/api/auth/register", { name: "Sam", email: uniqueEmail(), password: PASSWORD });
    assert.equal(response.status, 201);
    assert.match(response.setCookies[0], /;\s*Secure/i);
  });
});
