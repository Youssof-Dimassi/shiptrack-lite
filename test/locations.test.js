import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser } from "./helpers.js";

const { addShipmentUpdate, createShipment } = await import("../src/models/shipments.js");

const LOCATIONS = "/api/admin/locations";

let admin;

// A small, known world. Every place name is unique to this file.
const ship = (origin, destination, stops = []) => {
  const { trackingNumber } = createShipment({ origin, destination, estimatedDelivery: "2026-12-01" });
  for (const [status, location] of stops) addShipmentUpdate(trackingNumber, { status, location, description: "Moved" });
  return trackingNumber;
};

let fromZahle;
let toZahle;
let nowInZahle;
let throughZahle;
let deliveredInZahle;

before(async () => {
  ({ client: admin } = await createAdmin());
  fromZahle = ship("Zahle, Lebanon", "Byblos, Lebanon");
  toZahle = ship("Sidon, Lebanon", "Zahle, Lebanon");
  nowInZahle = ship("Tripoli, Lebanon", "Jounieh, Lebanon", [["In Transit", "Zahle Hub, Lebanon"]]);
  throughZahle = ship("Tyre, Lebanon", "Batroun, Lebanon", [["In Transit", "Zahle Hub, Lebanon"], ["Out for Delivery", "Batroun, Lebanon"]]);
  deliveredInZahle = ship("Aley, Lebanon", "Zahle, Lebanon", [["Delivered", "Zahle, Lebanon"]]);
  ship("Unrelated, Place", "Elsewhere, Place");
});

const report = (search) => admin("GET", `${LOCATIONS}?search=${encodeURIComponent(search)}`);

describe("who can see location reports", () => {
  for (const path of [`${LOCATIONS}?search=zahle`, `${LOCATIONS}/busiest`]) {
    it(`${path} answers 401 when not logged in and 403 for a customer`, async () => {
      assert.equal((await createClient()("GET", path)).status, 401);
      const { client } = await createLoggedInUser();
      assert.equal((await client("GET", path)).status, 403);
    });
  }
});

describe("the location report", () => {
  it("counts each way a shipment is connected to the place", async () => {
    const { counts } = (await report("Zahle")).json;
    assert.deepEqual(counts, {
      sentFrom: 1, // fromZahle
      goingTo: 2, // toZahle, deliveredInZahle
      lastSeen: 3, // fromZahle (created there), nowInZahle, deliveredInZahle
      passedThrough: 4, // fromZahle, nowInZahle, throughZahle, deliveredInZahle
      connected: 5,
    });
  });

  it("ignores capital letters and finds part of a name", async () => {
    assert.deepEqual((await report("zAhLe")).json.counts, (await report("Zahle")).json.counts);
    assert.equal((await report("Zahle Hub")).json.counts.passedThrough, 2);
  });

  it("lists the connected shipments, newest first, with how each one matches", async () => {
    const { shipments } = (await report("Zahle")).json;
    assert.deepEqual(shipments.map((s) => s.trackingNumber), [deliveredInZahle, throughZahle, nowInZahle, toZahle, fromZahle]);

    const through = shipments.find((s) => s.trackingNumber === throughZahle);
    assert.deepEqual(through.matches, { sentFrom: false, goingTo: false, lastSeen: false, passedThrough: true });
    assert.equal(through.lastLocation, "Batroun, Lebanon");

    const delivered = shipments.find((s) => s.trackingNumber === deliveredInZahle);
    assert.deepEqual(delivered.matches, { sentFrom: false, goingTo: true, lastSeen: true, passedThrough: true });
  });

  it("breaks the connected shipments down by status", async () => {
    const { byStatus, counts } = (await report("Zahle")).json;
    const byName = Object.fromEntries(byStatus.map((row) => [row.status, row.count]));
    assert.deepEqual(byName, { Pending: 2, "In Transit": 1, "Out for Delivery": 1, Delivered: 1, Cancelled: 0 });
    assert.equal(byStatus.reduce((sum, row) => sum + row.count, 0), counts.connected);
  });

  it("finds nothing for a place that isn't used", async () => {
    const { counts, shipments } = (await report("Atlantis")).json;
    assert.equal(counts.connected, 0);
    assert.deepEqual(shipments, []);
  });

  it("treats % and _ as normal characters", async () => {
    // If % and _ worked as wildcards, these would match almost every place.
    assert.equal((await report("a%")).json.counts.connected, 0);
    assert.equal((await report("_a")).json.counts.connected, 0);
  });

  it("rejects a SQL injection attempt safely", async () => {
    const response = await report("' OR '1'='1");
    assert.equal(response.status, 200);
    assert.equal(response.json.counts.connected, 0);
  });

  for (const [problem, query] of [
    ["a missing search", ""],
    ["a one-letter search", "?search=a"],
    ["only spaces", "?search=%20%20%20"],
    ["a very long search", `?search=${"x".repeat(101)}`],
    ["a repeated search", "?search=ab&search=cd"],
  ]) {
    it(`rejects ${problem}`, async () => {
      assert.equal((await admin("GET", `${LOCATIONS}${query}`)).status, 400);
    });
  }

  it("lists at most 50 shipments but counts them all", async () => {
    for (let i = 0; i < 52; i += 1) ship("Baalbek Depot", "Somewhere");
    const { counts, shipments, listLimit } = (await report("Baalbek Depot")).json;
    assert.equal(counts.sentFrom, 52);
    assert.equal(shipments.length, 50);
    assert.equal(listLimit, 50);
  });
});

describe("the busiest places", () => {
  it("counts each shipment once per place, ignoring capital letters", async () => {
    // 6 shipments, each mentioning the place 3 times with different capitals.
    for (let i = 0; i < 6; i += 1) ship("Hermel Square", "HERMEL SQUARE", [["In Transit", "hermel square"]]);
    const { places } = (await admin("GET", `${LOCATIONS}/busiest`)).json;
    assert.ok(places.length <= 10);
    const hermel = places.filter((p) => p.place.toLowerCase() === "hermel square");
    assert.equal(hermel.length, 1, "one row for every spelling");
    assert.equal(hermel[0].shipments, 6, "each shipment counted once, not once per spelling");
    const top = places[0];
    assert.equal(top.place, "Baalbek Depot");
    assert.equal(top.shipments, 52);
  });

  it("lists the busiest first", async () => {
    const { places } = (await admin("GET", `${LOCATIONS}/busiest`)).json;
    for (let i = 1; i < places.length; i += 1) assert.ok(places[i - 1].shipments >= places[i].shipments);
  });
});
