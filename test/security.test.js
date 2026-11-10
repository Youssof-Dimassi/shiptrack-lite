import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClient } from "./helpers.js";

const visitor = createClient();

function directive(policy, name) {
  const found = policy.split(";").map((part) => part.trim()).find((part) => part.split(" ")[0] === name);
  assert.ok(found, `${name} is missing from the policy`);
  return found;
}

describe("security headers", () => {
  it("sends a strict content security policy", async () => {
    const policy = (await visitor("GET", "/")).headers.get("content-security-policy");
    assert.equal(directive(policy, "default-src"), "default-src 'self'");
    assert.equal(directive(policy, "script-src"), "script-src 'self'");
    assert.equal(directive(policy, "object-src"), "object-src 'none'");
    assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'none'");
    assert.doesNotMatch(directive(policy, "style-src"), /unsafe/);
  });

  it("covers API responses too", async () => {
    assert.ok((await visitor("GET", "/api/health")).headers.get("content-security-policy"));
  });

  it("sets the other protective headers", async () => {
    const { headers } = await visitor("GET", "/");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.ok(headers.get("x-frame-options"));
    assert.ok(headers.get("referrer-policy"));
  });

  it("doesn't advertise the server software", async () => {
    assert.equal((await visitor("GET", "/")).headers.get("x-powered-by"), null);
  });

  it("doesn't force HTTPS while developing", async () => {
    const { headers } = await visitor("GET", "/");
    assert.equal(headers.get("strict-transport-security"), null);
    assert.doesNotMatch(headers.get("content-security-policy"), /upgrade-insecure-requests/);
  });

  it("every page loads only scripts from this site", async () => {
    for (const path of ["/", "/login", "/register", "/admin", "/my-shipments", "/forgot-password", "/reset-password", "/confirm-email", "/unsubscribe"]) {
      const { text, status } = await visitor("GET", path);
      assert.equal(status, 200, path);
      for (const [, source] of text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        assert.doesNotMatch(source, /^https?:/, `${path} loads ${source}`);
      }
      assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>/, `${path} has an inline script`);
      assert.doesNotMatch(text, /\son[a-z]+="/, `${path} has an inline event handler`);
      assert.doesNotMatch(text, /\sstyle="/, `${path} has an inline style`);
    }
  });
});

describe("demo mode while developing", () => {
  it("is on, with sample shipments", async () => {
    assert.deepEqual((await visitor("GET", "/api/config")).json, { demoMode: true });
    assert.equal((await visitor("GET", "/api/shipments/ST10000001")).status, 200);
  });
});
