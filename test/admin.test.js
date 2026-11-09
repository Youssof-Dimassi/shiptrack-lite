import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { before, describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser } from "./helpers.js";

const SHIPMENTS = "/api/admin/shipments";
const EVENTS = `${SHIPMENTS}/ST10000001/events`;

const NEW_SHIPMENT = { origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" };
const UPDATE = { status: "In Transit", location: "Athens", description: "Departed hub" };

const PROTECTED_ROUTES = [
  ["GET", SHIPMENTS, undefined],
  ["POST", SHIPMENTS, NEW_SHIPMENT],
  ["POST", EVENTS, UPDATE],
];

let admin;

before(async () => {
  ({ client: admin } = await createAdmin());
});

describe("who can use the admin API", () => {
  for (const [method, url, body] of PROTECTED_ROUTES) {
    it(`${method} ${url} answers 401 when not logged in`, async () => {
      assert.equal((await createClient()(method, url, body)).status, 401);
    });

    it(`${method} ${url} answers 403 for a customer`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client(method, url, body)).status, 403);
    });
  }

  it("a refused customer changes nothing", async () => {
    const before = (await admin("GET", SHIPMENTS)).json.total;
    const { client } = await createLoggedInUser();
    await client("POST", SHIPMENTS, NEW_SHIPMENT);
    assert.equal((await admin("GET", SHIPMENTS)).json.total, before);
  });
});

describe("creating shipments", () => {
  it("creates a Pending shipment with a generated tracking number", async () => {
    const response = await admin("POST", SHIPMENTS, NEW_SHIPMENT);
    assert.equal(response.status, 201);
    assert.match(response.json.shipment.trackingNumber, /^ST\d{8}$/);
    assert.equal(response.json.shipment.status, "Pending");
    assert.equal(response.json.shipment.events.length, 1);
  });

  it("generates different tracking numbers", async () => {
    const first = await admin("POST", SHIPMENTS, NEW_SHIPMENT);
    const second = await admin("POST", SHIPMENTS, NEW_SHIPMENT);
    assert.notEqual(first.json.shipment.trackingNumber, second.json.shipment.trackingNumber);
  });

  it("lists the newest shipment first", async () => {
    const created = await admin("POST", SHIPMENTS, NEW_SHIPMENT);
    const list = await admin("GET", SHIPMENTS);
    assert.equal(list.json.shipments[0].trackingNumber, created.json.shipment.trackingNumber);
  });

  for (const [problem, change] of [
    ["an empty origin", { origin: "" }],
    ["only spaces as the destination", { destination: "   " }],
    ["a very long origin", { origin: "x".repeat(121) }],
    ["a date that doesn't exist", { estimatedDelivery: "2026-02-31" }],
    ["a date in the wrong format", { estimatedDelivery: "soon" }],
    ["fields of the wrong type", { origin: ["a"], destination: {}, estimatedDelivery: 1 }],
  ]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await admin("POST", SHIPMENTS, { ...NEW_SHIPMENT, ...change })).status, 400);
    });
  }
});

describe("posting shipment updates", () => {
  it("changes the status and adds to the public history", async () => {
    const created = await admin("POST", SHIPMENTS, NEW_SHIPMENT);
    const number = created.json.shipment.trackingNumber;

    assert.equal((await admin("POST", `${SHIPMENTS}/${number}/events`, UPDATE)).status, 201);

    const publicView = await createClient()("GET", `/api/shipments/${number}`);
    assert.equal(publicView.json.status, "In Transit");
    assert.equal(publicView.json.events.length, 2);
    assert.equal(publicView.json.events[1].location, "Athens");
  });

  it("stores HTML as plain text without changing it", async () => {
    const attack = "<img src=x onerror=alert(1)>";
    const created = await admin("POST", SHIPMENTS, { ...NEW_SHIPMENT, origin: attack });
    assert.equal(created.json.shipment.origin, attack);
  });

  for (const [problem, change] of [
    ["an unknown status", { status: "Teleported" }],
    ["an empty location", { location: "" }],
    ["an empty description", { description: "" }],
    ["a very long description", { description: "x".repeat(201) }],
  ]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await admin("POST", EVENTS, { ...UPDATE, ...change })).status, 400);
    });
  }

  it("answers 404 for a shipment that doesn't exist", async () => {
    assert.equal((await admin("POST", `${SHIPMENTS}/ST99999999/events`, UPDATE)).status, 404);
  });

  it("answers 400 for a badly formatted tracking number", async () => {
    assert.equal((await admin("POST", `${SHIPMENTS}/nope/events`, UPDATE)).status, 400);
  });
});

describe("the make-admin command", () => {
  function runScript(args, databasePath = ":memory:") {
    return spawnSync(process.execPath, ["src/scripts/make-admin.js", ...args], {
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8",
    });
  }

  it("fails without an email", () => {
    assert.equal(runScript([]).status, 1);
  });

  it("fails for an account that doesn't exist", () => {
    const result = runScript(["nobody@example.com"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No account found/);
  });

  it("makes an existing account an admin", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "shiptrack-test-"));
    const databasePath = path.join(folder, "test.db");
    try {
      runScript(["nobody@example.com"], databasePath); // creates the tables

      const insert = new DatabaseSync(databasePath);
      insert.exec("INSERT INTO users (name, email, password_hash) VALUES ('Sam', 'sam@example.com', 'x')");
      insert.close();

      assert.equal(runScript(["SAM@example.com"], databasePath).status, 0);

      const check = new DatabaseSync(databasePath);
      const { role } = check.prepare("SELECT role FROM users WHERE email = 'sam@example.com'").get();
      check.close();
      assert.equal(role, "admin");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
