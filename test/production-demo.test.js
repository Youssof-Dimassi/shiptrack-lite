// A deployed demo, such as a portfolio link, can opt back in to sample data.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NODE_ENV = "production";
process.env.SEED_DEMO_DATA = "true";

const { createClient } = await import("./helpers.js");

describe("in production with SEED_DEMO_DATA=true", () => {
  it("has sample shipments and shows demo mode", async () => {
    const visitor = createClient();
    assert.equal((await visitor("GET", "/api/shipments/ST10000001")).status, 200);
    assert.deepEqual((await visitor("GET", "/api/config")).json, { demoMode: true });
  });
});
