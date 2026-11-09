import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAdmin, createClient, createLoggedInUser } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { createShipment } = await import("../src/models/shipments.js");
const { MAX_SAVED_SHIPMENTS, saveShipment } = await import("../src/models/savedShipments.js");

const MY = "/api/my-shipments";
const SAMPLE = "ST10000001";
const OTHER_SAMPLE = "ST10000002";

function saved(client) {
  return client("GET", MY).then((response) => response.json.shipments);
}

function newShipment() {
  return createShipment({ origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" });
}

describe("who can use My shipments", () => {
  for (const [method, url, body] of [
    ["GET", MY, undefined],
    ["POST", MY, { trackingNumber: SAMPLE }],
    ["DELETE", `${MY}/${SAMPLE}`, undefined],
  ]) {
    it(`${method} ${url} answers 401 when not logged in`, async () => {
      assert.equal((await createClient()(method, url, body)).status, 401);
    });
  }
});

describe("saving shipments", () => {
  it("starts empty", async () => {
    const { client } = await createLoggedInUser();
    assert.deepEqual(await saved(client), []);
  });

  it("saves a shipment and lists its details and latest update", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("POST", MY, { trackingNumber: SAMPLE })).status, 201);

    const [shipment] = await saved(client);
    assert.equal(shipment.trackingNumber, SAMPLE);
    assert.equal(shipment.status, "In Transit");
    assert.equal(shipment.destination, "Paris, France");
    assert.deepEqual(shipment.latestUpdate, { description: "Arrived at sorting hub", location: "Istanbul, Turkey" });
  });

  it("accepts lowercase and surrounding spaces", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("POST", MY, { trackingNumber: ` ${SAMPLE.toLowerCase()} ` })).status, 201);
    assert.equal((await saved(client))[0].trackingNumber, SAMPLE);
  });

  it("saving twice keeps a single entry", async () => {
    const { client } = await createLoggedInUser();
    await client("POST", MY, { trackingNumber: SAMPLE });
    assert.equal((await client("POST", MY, { trackingNumber: SAMPLE })).status, 200);
    assert.equal((await saved(client)).length, 1);
  });

  it("lists the most recently saved shipment first", async () => {
    const { client } = await createLoggedInUser();
    const first = newShipment().trackingNumber;
    const second = newShipment().trackingNumber;
    await client("POST", MY, { trackingNumber: first });
    await client("POST", MY, { trackingNumber: second });
    assert.deepEqual((await saved(client)).map((s) => s.trackingNumber), [second, first]);
  });

  it("answers 404 for a shipment that doesn't exist", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("POST", MY, { trackingNumber: "ST99999999" })).status, 404);
  });

  for (const [problem, value] of [["a bad format", "hello"], ["an empty value", ""], ["the wrong type", ["ST10000001"]]]) {
    it(`rejects ${problem}`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await client("POST", MY, { trackingNumber: value })).status, 400);
    });
  }

  it("enforces the maximum number of saved shipments", async () => {
    const { client } = await createLoggedInUser();
    const { user } = (await client("GET", "/api/auth/me")).json;
    for (let i = 0; i < MAX_SAVED_SHIPMENTS; i += 1) {
      assert.equal(saveShipment(user.id, newShipment().trackingNumber), "saved");
    }

    const extra = newShipment().trackingNumber;
    assert.equal((await client("POST", MY, { trackingNumber: extra })).status, 409);

    const alreadySaved = (await saved(client))[0].trackingNumber;
    assert.equal((await client("POST", MY, { trackingNumber: alreadySaved })).status, 200);
  });
});

describe("keeping customers separate", () => {
  it("doesn't show one customer's list to another", async () => {
    const { client: first } = await createLoggedInUser();
    const { client: second } = await createLoggedInUser();
    await first("POST", MY, { trackingNumber: SAMPLE });
    assert.deepEqual(await saved(second), []);
  });

  it("doesn't let one customer remove another's shipment", async () => {
    const { client: owner } = await createLoggedInUser();
    const { client: other } = await createLoggedInUser();
    await owner("POST", MY, { trackingNumber: SAMPLE });

    assert.equal((await other("DELETE", `${MY}/${SAMPLE}`)).status, 404);
    assert.equal((await saved(owner)).length, 1);
  });

  it("ignores a user id sent by the browser", async () => {
    const { client: first } = await createLoggedInUser();
    const { client: second } = await createLoggedInUser();
    const firstId = (await first("GET", "/api/auth/me")).json.user.id;

    await second("POST", MY, { trackingNumber: SAMPLE, userId: firstId, user_id: firstId });

    assert.deepEqual(await saved(first), []);
    assert.equal((await saved(second)).length, 1);
  });
});

describe("removing and staying up to date", () => {
  it("removes a saved shipment", async () => {
    const { client } = await createLoggedInUser();
    await client("POST", MY, { trackingNumber: SAMPLE });
    await client("POST", MY, { trackingNumber: OTHER_SAMPLE });

    assert.equal((await client("DELETE", `${MY}/${SAMPLE.toLowerCase()}`)).status, 204);
    assert.deepEqual((await saved(client)).map((s) => s.trackingNumber), [OTHER_SAMPLE]);
  });

  it("answers 404 when removing something not saved", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("DELETE", `${MY}/${SAMPLE}`)).status, 404);
  });

  it("shows new updates posted by staff", async () => {
    const { client: admin } = await createAdmin();
    const { client } = await createLoggedInUser();
    const number = newShipment().trackingNumber;
    await client("POST", MY, { trackingNumber: number });

    await admin("POST", `/api/admin/shipments/${number}/events`, {
      status: "Out for Delivery",
      location: "Rome",
      description: "Out with courier",
    });

    const [shipment] = await saved(client);
    assert.equal(shipment.status, "Out for Delivery");
    assert.deepEqual(shipment.latestUpdate, { description: "Out with courier", location: "Rome" });
  });

  it("drops a shipment from the list when it's deleted", async () => {
    const { client } = await createLoggedInUser();
    const number = newShipment().trackingNumber;
    await client("POST", MY, { trackingNumber: number });

    db.prepare("DELETE FROM shipments WHERE tracking_number = ?").run(number);

    const leftovers = db.prepare("SELECT COUNT(*) AS count FROM saved_shipments WHERE shipment_id NOT IN (SELECT id FROM shipments)").get();
    assert.equal(leftovers.count, 0);

    assert.deepEqual(await saved(client), []);
  });
});

describe("the public tracking result", () => {
  it("says nothing about saving to a visitor who isn't logged in", async () => {
    const response = await createClient()("GET", `/api/shipments/${SAMPLE}`);
    assert.equal(response.json.saved, undefined);
  });

  it("tells a logged-in customer whether it's saved", async () => {
    const { client } = await createLoggedInUser();
    assert.equal((await client("GET", `/api/shipments/${SAMPLE}`)).json.saved, false);
    await client("POST", MY, { trackingNumber: SAMPLE });
    assert.equal((await client("GET", `/api/shipments/${SAMPLE}`)).json.saved, true);
  });
});

describe("limiting tracking lookups", () => {
  const LIMIT = 60;

  it("blocks an address that tries too many numbers", async () => {
    const visitor = createClient();
    for (let i = 0; i < LIMIT; i += 1) {
      assert.equal((await visitor("GET", "/api/shipments/ST99999999")).status, 404);
    }
    const blocked = await visitor("GET", `/api/shipments/${SAMPLE}`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });

  it("can't be bypassed by saving instead of looking up", async () => {
    const { client } = await createLoggedInUser();
    for (let i = 0; i < LIMIT; i += 1) await client("GET", "/api/shipments/ST99999999");
    assert.equal((await client("POST", MY, { trackingNumber: SAMPLE })).status, 429);
  });
});
