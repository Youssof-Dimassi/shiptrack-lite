import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { addShipmentUpdate, createShipment } = await import("../src/models/shipments.js");

const SHIPMENTS = "/api/admin/shipments";
const DETAILS = { origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" };
const PAGE_SIZE = 20;
const CREATED = 45;
const SEEDED = 3;

let admin;
let oslo;
let shippingOdd;

before(async () => {
  ({ client: admin } = await createAdmin());
  for (let i = 0; i < CREATED; i += 1) createShipment(DETAILS);
  oslo = createShipment({ ...DETAILS, origin: "Oslo", destination: "Madrid" });
  shippingOdd = createShipment({ ...DETAILS, origin: "100% Depot_A" });
  addShipmentUpdate(oslo.trackingNumber, { status: "Cancelled", location: "Oslo", description: "Cancelled" });
});

const TOTAL = CREATED + SEEDED + 2;
const list = (query = "") => admin("GET", `${SHIPMENTS}${query}`);
const numbers = (response) => response.json.shipments.map((s) => s.trackingNumber);

describe("paging through shipments", () => {
  it("returns the first page by default", async () => {
    const response = await list();
    assert.equal(response.status, 200);
    assert.equal(response.json.shipments.length, PAGE_SIZE);
    assert.equal(response.json.page, 1);
    assert.equal(response.json.pageSize, PAGE_SIZE);
    assert.equal(response.json.total, TOTAL);
    assert.equal(response.json.totalPages, Math.ceil(TOTAL / PAGE_SIZE));
  });

  it("shows every shipment exactly once across the pages", async () => {
    const all = [];
    for (let page = 1; page <= 3; page += 1) all.push(...numbers(await list(`?page=${page}`)));
    assert.equal(all.length, TOTAL);
    assert.equal(new Set(all).size, TOTAL);
  });

  it("lists the newest first", async () => {
    assert.equal(numbers(await list())[0], shippingOdd.trackingNumber);
  });

  it("gives the last page when asked for one past the end", async () => {
    const response = await list("?page=999");
    assert.equal(response.status, 200);
    assert.equal(response.json.page, 3);
    assert.ok(response.json.shipments.length > 0);
  });

  for (const bad of ["0", "-1", "abc", "1.5", "", "1&page=2", "99999999999"]) {
    it(`rejects the page number "${bad}"`, async () => {
      assert.equal((await list(`?page=${bad}`)).status, 400);
    });
  }
});

describe("searching", () => {
  it("finds by tracking number", async () => {
    const response = await list(`?search=${oslo.trackingNumber}`);
    assert.deepEqual(numbers(response), [oslo.trackingNumber]);
    assert.equal(response.json.total, 1);
  });

  it("finds by origin, ignoring case", async () => {
    assert.deepEqual(numbers(await list("?search=oSLo")), [oslo.trackingNumber]);
  });

  it("finds by destination", async () => {
    assert.deepEqual(numbers(await list("?search=madrid")), [oslo.trackingNumber]);
  });

  it("finds part of a word", async () => {
    assert.deepEqual(numbers(await list("?search=adri")), [oslo.trackingNumber]);
  });

  it("ignores spaces around the search", async () => {
    assert.deepEqual(numbers(await list("?search=%20oslo%20")), [oslo.trackingNumber]);
  });

  it("treats % as an ordinary character", async () => {
    assert.deepEqual(numbers(await list(`?search=${encodeURIComponent("100%")}`)), [shippingOdd.trackingNumber]);
    assert.equal((await list(`?search=${encodeURIComponent("%")}`)).json.total, 1);
  });

  it("treats _ as an ordinary character", async () => {
    assert.equal((await list("?search=_")).json.total, 1);
  });

  it("treats a backslash as an ordinary character", async () => {
    const response = await list(`?search=${encodeURIComponent("\\")}`);
    assert.equal(response.status, 200);
    assert.equal(response.json.total, 0);
  });

  it("rejects a SQL injection attempt", async () => {
    const response = await list(`?search=${encodeURIComponent("' OR '1'='1")}`);
    assert.equal(response.status, 200);
    assert.equal(response.json.total, 0);
  });

  it("returns an empty first page when nothing matches", async () => {
    const response = await list("?search=does-not-exist");
    assert.deepEqual(response.json.shipments, []);
    assert.equal(response.json.page, 1);
    assert.equal(response.json.totalPages, 1);
  });

  it("rejects a very long search", async () => {
    assert.equal((await list(`?search=${"x".repeat(101)}`)).status, 400);
  });

  it("rejects a repeated search value", async () => {
    assert.equal((await list("?search=a&search=b")).status, 400);
  });
});

describe("filtering by status", () => {
  it("returns only that status", async () => {
    const response = await list(`?status=${encodeURIComponent("Cancelled")}`);
    assert.deepEqual(numbers(response), [oslo.trackingNumber]);
  });

  it("combines with search", async () => {
    assert.equal((await list("?status=Pending&search=oslo")).json.total, 0);
    assert.equal((await list("?status=Cancelled&search=oslo")).json.total, 1);
  });

  it("counts each status for the sidebar", async () => {
    const { counts } = (await list()).json;
    assert.equal(counts.all, TOTAL);
    assert.equal(counts.byStatus.Cancelled, 1);
    assert.equal(counts.byStatus.Delivered, 1);
    assert.equal(counts.byStatus["In Transit"], 1);
    assert.equal(counts.byStatus.Pending, CREATED + 2);
  });

  it("keeps the sidebar counts the same while filtering or searching", async () => {
    const unfiltered = (await list()).json.counts;
    assert.deepEqual((await list("?status=Cancelled")).json.counts, unfiltered);
    assert.deepEqual((await list("?search=oslo")).json.counts, unfiltered);
  });

  for (const bad of ["Teleported", "", "pending"]) {
    it(`rejects the status "${bad}"`, async () => {
      assert.equal((await list(`?status=${bad}`)).status, 400);
    });
  }
});

describe("who can edit and delete", () => {
  for (const [method, body] of [["PUT", DETAILS], ["DELETE", undefined]]) {
    it(`${method} answers 401 when not logged in`, async () => {
      assert.equal((await createClient()(method, `${SHIPMENTS}/ST10000001`, body)).status, 401);
    });

    it(`${method} answers 403 for a customer and changes nothing`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client(method, `${SHIPMENTS}/ST10000001`, body)).status, 403);
      const stillThere = await createClient()("GET", "/api/shipments/ST10000001");
      assert.equal(stillThere.json.origin, "Beirut, Lebanon");
    });
  }
});

describe("editing shipments", () => {
  const CHANGES = { origin: "  Athens ", destination: "Vienna", estimatedDelivery: "2027-01-15" };

  it("updates the details, and customers see them", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    const response = await admin("PUT", `${SHIPMENTS}/${trackingNumber}`, CHANGES);
    assert.equal(response.status, 200);
    assert.equal(response.json.shipment.origin, "Athens");

    const publicView = await createClient()("GET", `/api/shipments/${trackingNumber}`);
    assert.equal(publicView.json.destination, "Vienna");
    assert.equal(publicView.json.estimatedDelivery, "2027-01-15");
  });

  it("keeps the status and history", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    addShipmentUpdate(trackingNumber, { status: "In Transit", location: "Rome", description: "Moving" });

    const { shipment } = (await admin("PUT", `${SHIPMENTS}/${trackingNumber}`, CHANGES)).json;
    assert.equal(shipment.status, "In Transit");
    assert.equal(shipment.events.length, 2);
  });

  it("can't change the tracking number or status", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    const body = { ...CHANGES, trackingNumber: "ST11111111", tracking_number: "ST11111111", status: "Delivered" };
    const { shipment } = (await admin("PUT", `${SHIPMENTS}/${trackingNumber}`, body)).json;
    assert.equal(shipment.trackingNumber, trackingNumber);
    assert.equal(shipment.status, "Pending");
  });

  it("only changes the chosen shipment", async () => {
    const first = createShipment(DETAILS);
    const second = createShipment(DETAILS);
    await admin("PUT", `${SHIPMENTS}/${first.trackingNumber}`, CHANGES);
    const untouched = await createClient()("GET", `/api/shipments/${second.trackingNumber}`);
    assert.equal(untouched.json.origin, DETAILS.origin);
  });

  it("accepts lowercase tracking numbers", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    assert.equal((await admin("PUT", `${SHIPMENTS}/${trackingNumber.toLowerCase()}`, CHANGES)).status, 200);
  });

  for (const [problem, change] of [
    ["an empty origin", { origin: "" }],
    ["an empty destination", { destination: " " }],
    ["a very long origin", { origin: "x".repeat(121) }],
    ["a date that doesn't exist", { estimatedDelivery: "2026-02-31" }],
    ["fields of the wrong type", { origin: ["a"], destination: {}, estimatedDelivery: 1 }],
  ]) {
    it(`rejects ${problem}, leaving the shipment unchanged`, async () => {
      const { trackingNumber } = createShipment(DETAILS);
      assert.equal((await admin("PUT", `${SHIPMENTS}/${trackingNumber}`, { ...CHANGES, ...change })).status, 400);
      const unchanged = await createClient()("GET", `/api/shipments/${trackingNumber}`);
      assert.equal(unchanged.json.origin, DETAILS.origin);
    });
  }

  it("answers 404 for a shipment that doesn't exist", async () => {
    assert.equal((await admin("PUT", `${SHIPMENTS}/ST99999999`, CHANGES)).status, 404);
  });

  it("answers 400 for a badly formatted tracking number", async () => {
    assert.equal((await admin("PUT", `${SHIPMENTS}/nope`, CHANGES)).status, 400);
  });
});

describe("deleting shipments", () => {
  it("removes it from tracking and the admin list", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    assert.equal((await admin("DELETE", `${SHIPMENTS}/${trackingNumber}`)).status, 204);
    assert.equal((await createClient()("GET", `/api/shipments/${trackingNumber}`)).status, 404);
    assert.equal((await list(`?search=${trackingNumber}`)).json.total, 0);
  });

  it("also removes its history and customers' saved links", async () => {
    const { client } = await createLoggedInUser();
    const { trackingNumber } = createShipment(DETAILS);
    await client("POST", "/api/my-shipments", { trackingNumber });

    await admin("DELETE", `${SHIPMENTS}/${trackingNumber}`);

    assert.deepEqual((await client("GET", "/api/my-shipments")).json.shipments, []);
    const orphans = db.prepare("SELECT COUNT(*) AS count FROM shipment_events WHERE shipment_id NOT IN (SELECT id FROM shipments)").get();
    assert.equal(orphans.count, 0);
  });

  it("only deletes the chosen shipment", async () => {
    const first = createShipment(DETAILS);
    const second = createShipment(DETAILS);
    await admin("DELETE", `${SHIPMENTS}/${first.trackingNumber}`);
    assert.equal((await createClient()("GET", `/api/shipments/${second.trackingNumber}`)).status, 200);
  });

  it("answers 404 when deleted twice", async () => {
    const { trackingNumber } = createShipment(DETAILS);
    await admin("DELETE", `${SHIPMENTS}/${trackingNumber}`);
    assert.equal((await admin("DELETE", `${SHIPMENTS}/${trackingNumber}`)).status, 404);
  });

  it("answers 400 for a badly formatted tracking number", async () => {
    assert.equal((await admin("DELETE", `${SHIPMENTS}/nope`)).status, 400);
  });
});
