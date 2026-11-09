import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClient } from "./helpers.js";

const visitor = createClient();

describe("public shipment tracking", () => {
  it("returns a shipment with its history", async () => {
    const response = await visitor("GET", "/api/shipments/ST10000001");
    assert.equal(response.status, 200);
    assert.equal(response.json.trackingNumber, "ST10000001");
    assert.equal(response.json.status, "In Transit");
    assert.equal(response.json.events.length, 3);
  });

  it("accepts lowercase and surrounding spaces", async () => {
    const response = await visitor("GET", "/api/shipments/st10000002%20");
    assert.equal(response.status, 200);
    assert.equal(response.json.trackingNumber, "ST10000002");
  });

  it("answers 404 for a number that doesn't exist", async () => {
    const response = await visitor("GET", "/api/shipments/ST99999999");
    assert.equal(response.status, 404);
    assert.match(response.json.error, /No shipment found/);
  });

  for (const badNumber of ["hello", "ST123", "ST100000011", "AB10000001"]) {
    it(`answers 400 for the badly formatted number ${badNumber}`, async () => {
      assert.equal((await visitor("GET", `/api/shipments/${badNumber}`)).status, 400);
    });
  }

  it("rejects a SQL injection attempt", async () => {
    const attack = encodeURIComponent("' OR '1'='1");
    const response = await visitor("GET", `/api/shipments/${attack}`);
    assert.equal(response.status, 400);
    assert.equal(response.json.trackingNumber, undefined);
  });
});

describe("the rest of the site", () => {
  it("reports that it is healthy", async () => {
    const response = await visitor("GET", "/api/health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { status: "ok" });
  });

  for (const [path, type] of [
    ["/", "text/html"],
    ["/login", "text/html"],
    ["/register", "text/html"],
    ["/admin", "text/html"],
    ["/style.css", "text/css"],
    ["/theme.js", "text/javascript"],
    ["/favicon.svg", "image/svg+xml"],
    ["/my-shipments", "text/html"],
    ["/forgot-password", "text/html"],
    ["/reset-password", "text/html"],
    ["/confirm-email", "text/html"],
  ]) {
    it(`serves ${path}`, async () => {
      const response = await visitor("GET", path);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type").includes(type));
    });
  }

  it("answers 404 for an unknown page", async () => {
    assert.equal((await visitor("GET", "/this-page-does-not-exist")).status, 404);
  });

  it("answers 404 in JSON for an unknown API route", async () => {
    const response = await visitor("GET", "/api/nope");
    assert.equal(response.status, 404);
    assert.equal(response.json.error, "API route not found.");
  });

  for (const path of ["/src/server.js", "/package.json", "/shiptrack.db", "/../package.json", "/%2e%2e/package.json"]) {
    it(`never serves private files: ${path}`, async () => {
      assert.equal((await visitor("GET", path)).status, 404);
    });
  }
});
