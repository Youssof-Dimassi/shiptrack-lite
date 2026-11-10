import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser } from "./helpers.js";

const { addShipmentUpdate, createShipment } = await import("../src/models/shipments.js");

const ADMIN = "/api/admin/shipments";
const DETAILS = { origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" };

let admin;

before(async () => {
  ({ client: admin } = await createAdmin());
});

// A shipment with two history entries. Returns its number and entry ids.
function shipmentWithHistory() {
  const { trackingNumber } = createShipment(DETAILS);
  const { shipment } = addShipmentUpdate(trackingNumber, { status: "In Transit", location: "Athen", description: "Departed hubb" });
  return { trackingNumber, created: shipment.events[0].id, update: shipment.events[1].id };
}

function publicView(trackingNumber) {
  return createClient()("GET", `/api/shipments/${trackingNumber}`).then((response) => response.json);
}

const entryUrl = (trackingNumber, id) => `${ADMIN}/${trackingNumber}/events/${id}`;

describe("viewing one shipment as staff", () => {
  it("returns it with its history and entry ids", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    const response = await admin("GET", `${ADMIN}/${trackingNumber}`);
    assert.equal(response.status, 200);
    assert.equal(response.json.shipment.events[1].id, update);
  });

  it("answers 404 for a shipment that doesn't exist", async () => {
    assert.equal((await admin("GET", `${ADMIN}/ST99999999`)).status, 404);
  });
});

describe("who can change the history", () => {
  for (const [method, body] of [["PUT", { location: "x", description: "y" }], ["DELETE", undefined]]) {
    it(`${method} answers 401 when not logged in and 403 for a customer`, async () => {
      const { trackingNumber, update } = shipmentWithHistory();
      assert.equal((await createClient()(method, entryUrl(trackingNumber, update), body)).status, 401);
      const { client } = await createLoggedInUser();
      assert.equal((await client(method, entryUrl(trackingNumber, update), body)).status, 403);
      assert.equal((await publicView(trackingNumber)).events.length, 2);
    });
  }
});

describe("fixing a history entry", () => {
  it("corrects the text, and customers see it", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    const response = await admin("PUT", entryUrl(trackingNumber, update), { location: " Athens ", description: "Departed hub" });
    assert.equal(response.status, 200);

    const entry = (await publicView(trackingNumber)).events[1];
    assert.equal(entry.location, "Athens");
    assert.equal(entry.description, "Departed hub");
  });

  it("keeps the status, the date, and the other entries", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    const before = await publicView(trackingNumber);
    await admin("PUT", entryUrl(trackingNumber, update), { location: "Athens", description: "Departed hub" });
    const after = await publicView(trackingNumber);

    assert.equal(after.status, "In Transit");
    assert.equal(after.events[1].date, before.events[1].date);
    assert.deepEqual(after.events[0], before.events[0]);
  });

  it("can't change an entry that belongs to another shipment", async () => {
    const first = shipmentWithHistory();
    const second = shipmentWithHistory();
    const response = await admin("PUT", entryUrl(first.trackingNumber, second.update), { location: "Hacked", description: "Hacked" });
    assert.equal(response.status, 404);
    assert.equal((await publicView(second.trackingNumber)).events[1].location, "Athen");
  });

  for (const [problem, body] of [
    ["an empty location", { location: "", description: "ok" }],
    ["an empty description", { location: "ok", description: "  " }],
    ["a very long description", { location: "ok", description: "x".repeat(201) }],
    ["fields of the wrong type", { location: ["a"], description: {} }],
  ]) {
    it(`rejects ${problem}`, async () => {
      const { trackingNumber, update } = shipmentWithHistory();
      assert.equal((await admin("PUT", entryUrl(trackingNumber, update), body)).status, 400);
      assert.equal((await publicView(trackingNumber)).events[1].description, "Departed hubb");
    });
  }

  it("answers 404 for an entry that doesn't exist", async () => {
    const { trackingNumber } = shipmentWithHistory();
    assert.equal((await admin("PUT", entryUrl(trackingNumber, 999999), { location: "a", description: "b" })).status, 404);
  });

  for (const badId of ["abc", "0", "-1", "1.5", "99999999999999999999"]) {
    it(`answers 400 for the entry id ${badId}`, async () => {
      const { trackingNumber } = shipmentWithHistory();
      assert.equal((await admin("PUT", entryUrl(trackingNumber, badId), { location: "a", description: "b" })).status, 400);
    });
  }
});

describe("removing a history entry", () => {
  it("removes it, and customers no longer see it", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    const response = await admin("DELETE", entryUrl(trackingNumber, update));
    assert.equal(response.status, 200);
    assert.equal(response.json.shipment.events.length, 1);
    assert.equal((await publicView(trackingNumber)).events.length, 1);
  });

  it("keeps the status (staff post an update to change it)", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    await admin("DELETE", entryUrl(trackingNumber, update));
    assert.equal((await publicView(trackingNumber)).status, "In Transit");
  });

  it("won't remove the last entry", async () => {
    const { trackingNumber, created, update } = shipmentWithHistory();
    await admin("DELETE", entryUrl(trackingNumber, update));
    const response = await admin("DELETE", entryUrl(trackingNumber, created));
    assert.equal(response.status, 409);
    assert.equal((await publicView(trackingNumber)).events.length, 1);
  });

  it("can't remove an entry that belongs to another shipment", async () => {
    const first = shipmentWithHistory();
    const second = shipmentWithHistory();
    assert.equal((await admin("DELETE", entryUrl(first.trackingNumber, second.update))).status, 404);
    assert.equal((await publicView(second.trackingNumber)).events.length, 2);
  });

  it("answers 404 when removed twice", async () => {
    const { trackingNumber, update } = shipmentWithHistory();
    await admin("DELETE", entryUrl(trackingNumber, update));
    assert.equal((await admin("DELETE", entryUrl(trackingNumber, update))).status, 404);
  });
});
