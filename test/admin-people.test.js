import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { PASSWORD, createAdmin, createClient, createLoggedInUser, uniqueEmail } from "./helpers.js";

const { db } = await import("../src/db/database.js");
const { deleteActivityBefore } = await import("../src/models/activityLog.js");
const { lastWeekStarts } = await import("../src/models/dashboard.js");

const API = "/api/admin";
const DETAILS = { origin: "Beirut", destination: "Rome", estimatedDelivery: "2026-12-01" };

let admin;
let adminEmail;

before(async () => {
  ({ client: admin, email: adminEmail } = await createAdmin());
});

async function latestActivity(category = "") {
  const query = category ? `?category=${category}` : "";
  return (await admin("GET", `${API}/activity${query}`)).json.entries[0];
}

function userIdOf(client) {
  return client("GET", "/api/auth/me").then((response) => response.json.user.id);
}

describe("who can use the staff pages' data", () => {
  for (const [method, path, body] of [
    ["GET", "/dashboard"],
    ["GET", "/activity"],
    ["GET", "/users"],
    ["PUT", "/users/1/role", { role: "admin" }],
    ["DELETE", "/users/1"],
  ]) {
    it(`${method} ${path} answers 401 when not logged in and 403 for a customer`, async () => {
      assert.equal((await createClient()(method, `${API}${path}`, body)).status, 401);
      const { client } = await createLoggedInUser();
      assert.equal((await client(method, `${API}${path}`, body)).status, 403);
    });
  }

  it("a customer can't make themselves an admin", async () => {
    const { client } = await createLoggedInUser();
    const id = await userIdOf(client);
    await client("PUT", `${API}/users/${id}/role`, { role: "admin" });
    assert.equal((await client("GET", "/api/auth/me")).json.user.role, "customer");
  });
});

describe("the activity log", () => {
  it("records every kind of shipment change, with who did it", async () => {
    const created = await admin("POST", `${API}/shipments`, DETAILS);
    const number = created.json.shipment.trackingNumber;
    let entry = await latestActivity();
    assert.equal(entry.action, "shipment.created");
    assert.equal(entry.summary, `Created ${number} (Beirut → Rome)`);
    assert.equal(entry.actorEmail, adminEmail);
    assert.equal(entry.actorName, "Test User");

    const posted = await admin("POST", `${API}/shipments/${number}/events`, { status: "In Transit", location: "Athens", description: "Departed" });
    assert.equal((await latestActivity()).summary, `Posted "In Transit" on ${number}: Departed`);

    await admin("PUT", `${API}/shipments/${number}`, { ...DETAILS, origin: "Tyre" });
    assert.equal((await latestActivity()).summary, `Edited the details of ${number}`);

    const entryId = posted.json.shipment.events.at(-1).id;
    await admin("PUT", `${API}/shipments/${number}/events/${entryId}`, { location: "Athens", description: "Departed hub" });
    assert.equal((await latestActivity()).action, "shipment.history_edited");

    await admin("DELETE", `${API}/shipments/${number}/events/${entryId}`);
    assert.equal((await latestActivity()).action, "shipment.history_deleted");

    await admin("DELETE", `${API}/shipments/${number}`);
    entry = await latestActivity();
    assert.equal(entry.action, "shipment.deleted");
    assert.equal(entry.summary, `Deleted ${number}`);
  });

  it("records nothing for a change that failed", async () => {
    const before = (await admin("GET", `${API}/activity`)).json.total;
    await admin("POST", `${API}/shipments`, { ...DETAILS, origin: "" });
    await admin("DELETE", `${API}/shipments/ST99999999`);
    await admin("POST", `${API}/shipments/ST99999999/events`, { status: "In Transit", location: "x", description: "y" });
    assert.equal((await admin("GET", `${API}/activity`)).json.total, before);
  });

  it("records nothing for what customers do", async () => {
    const before = (await admin("GET", `${API}/activity`)).json.total;
    const { client } = await createLoggedInUser();
    await client("POST", "/api/my-shipments", { trackingNumber: "ST10000001" });
    await client("PUT", "/api/account/profile", { name: "New name" });
    assert.equal((await admin("GET", `${API}/activity`)).json.total, before);
  });

  it("filters by category", async () => {
    await admin("POST", `${API}/shipments`, DETAILS);
    const { entries } = (await admin("GET", `${API}/activity?category=shipment`)).json;
    assert.ok(entries.length > 0);
    assert.ok(entries.every((entry) => entry.action.startsWith("shipment.")));
  });

  for (const bad of ["?category=nope", "?page=0", "?page=abc", "?category=shipment&category=user"]) {
    it(`rejects ${bad}`, async () => {
      assert.equal((await admin("GET", `${API}/activity${bad}`)).status, 400);
    });
  }

  it("lists the newest first and pages through them", async () => {
    for (let i = 0; i < 3; i += 1) await admin("POST", `${API}/shipments`, DETAILS);
    const { entries, total, totalPages, pageSize } = (await admin("GET", `${API}/activity`)).json;
    assert.equal(pageSize, 50);
    assert.equal(totalPages, Math.max(1, Math.ceil(total / 50)));
    assert.ok(entries[0].id > entries[1].id);
  });

  it("keeps entries readable after the staff member's account is deleted", async () => {
    const { client: other } = await createAdmin();
    const created = await other("POST", `${API}/shipments`, DETAILS);
    const number = created.json.shipment.trackingNumber;
    await other("DELETE", "/api/account", { password: PASSWORD });

    const entry = (await admin("GET", `${API}/activity`)).json.entries.find((e) => e.summary.includes(number));
    assert.equal(entry.actorName, "Test User");
    assert.equal(entry.actorDeleted, true);
  });

  it("can remove entries older than a cut-off date", () => {
    const before = db.prepare("SELECT COUNT(*) AS count FROM activity_log").get().count;
    assert.equal(deleteActivityBefore("2000-01-01T00:00:00.000Z"), 0);
    assert.equal(deleteActivityBefore("2999-01-01T00:00:00.000Z"), before);
  });
});

describe("managing users", () => {
  it("lists users without any password information", async () => {
    const { email } = await createLoggedInUser();
    const response = await admin("GET", `${API}/users?search=${encodeURIComponent(email)}`);
    assert.equal(response.status, 200);
    const [user] = response.json.users;
    assert.equal(user.email, email);
    assert.equal(user.role, "customer");
    assert.equal(user.savedShipments, 0);
    assert.match(user.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.doesNotMatch(response.text, /password|scrypt|token/i);
    assert.equal(typeof response.json.currentUserId, "number");
  });

  it("searches by name, ignoring case, and treats % as a normal character", async () => {
    const { client } = await createLoggedInUser();
    await client("PUT", "/api/account/profile", { name: "Zara Unique-Name" });
    assert.equal((await admin("GET", `${API}/users?search=zara%20unique`)).json.total, 1);
    assert.equal((await admin("GET", `${API}/users?search=${encodeURIComponent("%")}`)).json.total, 0);
  });

  it("makes a customer an admin, who can then use the staff pages", async () => {
    const { client } = await createLoggedInUser();
    const id = await userIdOf(client);
    const response = await admin("PUT", `${API}/users/${id}/role`, { role: "admin" });
    assert.equal(response.status, 200);
    assert.equal(response.json.user.role, "admin");
    assert.equal((await client("GET", `${API}/users`)).status, 200);
    assert.match((await latestActivity("user")).summary, /^Made user\d+@example\.com an admin$/);
  });

  it("removes admin access, effective immediately", async () => {
    const { client } = await createAdmin();
    const id = await userIdOf(client);
    await admin("PUT", `${API}/users/${id}/role`, { role: "customer" });
    assert.equal((await client("GET", `${API}/users`)).status, 403);
    assert.match((await latestActivity("user")).summary, /^Removed admin access from /);
  });

  it("records nothing when the role is already set", async () => {
    const { client } = await createLoggedInUser();
    const id = await userIdOf(client);
    const before = (await admin("GET", `${API}/activity`)).json.total;
    assert.equal((await admin("PUT", `${API}/users/${id}/role`, { role: "customer" })).status, 200);
    assert.equal((await admin("GET", `${API}/activity`)).json.total, before);
  });

  it("won't let you change your own role", async () => {
    const id = await userIdOf(admin);
    assert.equal((await admin("PUT", `${API}/users/${id}/role`, { role: "customer" })).status, 409);
    assert.equal((await admin("GET", "/api/auth/me")).json.user.role, "admin");
  });

  for (const role of ["owner", "", null, ["admin"]]) {
    it(`rejects the role ${JSON.stringify(role)}`, async () => {
      const { client } = await createLoggedInUser();
      assert.equal((await admin("PUT", `${API}/users/${await userIdOf(client)}/role`, { role })).status, 400);
    });
  }

  it("deletes a customer's account", async () => {
    const { client, email } = await createLoggedInUser();
    const id = await userIdOf(client);
    assert.equal((await admin("DELETE", `${API}/users/${id}`)).status, 204);
    assert.equal((await createClient()("POST", "/api/auth/login", { email, password: PASSWORD })).status, 401);
    assert.equal((await client("GET", "/api/auth/me")).status, 401);
    assert.equal((await latestActivity("user")).summary, `Deleted the account of ${email}`);
  });

  it("won't delete an admin, or yourself", async () => {
    const { client } = await createAdmin();
    assert.equal((await admin("DELETE", `${API}/users/${await userIdOf(client)}`)).status, 409);
    assert.equal((await admin("DELETE", `${API}/users/${await userIdOf(admin)}`)).status, 409);
    assert.equal((await client("GET", "/api/auth/me")).status, 200);
  });

  for (const [problem, path, status] of [["an unknown user", "/users/999999", 404], ["a bad id", "/users/abc", 400], ["id zero", "/users/0", 400]]) {
    it(`answers ${status} for ${problem}`, async () => {
      assert.equal((await admin("DELETE", `${API}${path}`)).status, status);
      assert.equal((await admin("PUT", `${API}${path}/role`, { role: "admin" })).status, status);
    });
  }
});

describe("the dashboard", () => {
  it("counts totals from the database", async () => {
    const { totals } = (await admin("GET", `${API}/dashboard`)).json;
    const expected = db.prepare(`
      SELECT (SELECT COUNT(*) FROM shipments) AS shipments,
             (SELECT COUNT(*) FROM shipments WHERE status NOT IN ('Delivered', 'Cancelled')) AS active,
             (SELECT COUNT(*) FROM shipments WHERE status = 'Delivered') AS delivered,
             (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
             (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins
    `).get();
    for (const key of Object.keys(expected)) assert.equal(totals[key], expected[key], key);
  });

  it("lists every status, including ones with no shipments", async () => {
    const { byStatus, totals } = (await admin("GET", `${API}/dashboard`)).json;
    assert.deepEqual(byStatus.map((row) => row.status), ["Pending", "In Transit", "Out for Delivery", "Delivered", "Cancelled"]);
    assert.equal(byStatus.reduce((sum, row) => sum + row.count, 0), totals.shipments);
  });

  it("counts shipments started this week", async () => {
    const before = (await admin("GET", `${API}/dashboard`)).json.startedPerWeek;
    await admin("POST", `${API}/shipments`, DETAILS);
    const after = (await admin("GET", `${API}/dashboard`)).json.startedPerWeek;
    assert.equal(after.length, 8);
    assert.equal(after[7].count, before[7].count + 1);
  });

  it("finds overdue shipments, but not delivered ones", async () => {
    const late = (await admin("POST", `${API}/shipments`, { ...DETAILS, estimatedDelivery: "2020-01-01" })).json.shipment.trackingNumber;
    const done = (await admin("POST", `${API}/shipments`, { ...DETAILS, estimatedDelivery: "2020-01-02" })).json.shipment.trackingNumber;
    await admin("POST", `${API}/shipments/${done}/events`, { status: "Delivered", location: "Rome", description: "Delivered" });

    const { totals, overdueShipments } = (await admin("GET", `${API}/dashboard`)).json;
    const numbers = overdueShipments.map((s) => s.trackingNumber);
    assert.ok(numbers.includes(late));
    assert.ok(!numbers.includes(done));
    assert.ok(totals.overdue >= 1);
  });

  it("works out the average delivery time from first to last entry", async () => {
    const expected = db.prepare(`
      SELECT AVG(julianday(MAX_T) - julianday(MIN_T)) AS days FROM (
        SELECT MIN(e.occurred_at) AS MIN_T, MAX(e.occurred_at) AS MAX_T
        FROM shipments s JOIN shipment_events e ON e.shipment_id = s.id
        WHERE s.status = 'Delivered' GROUP BY s.id)
    `).get().days;
    const { averageDeliveryDays } = (await admin("GET", `${API}/dashboard`)).json;
    assert.equal(averageDeliveryDays, Math.round(expected * 10) / 10);
  });

  it("shows the five latest activity entries", async () => {
    const { recentActivity } = (await admin("GET", `${API}/dashboard`)).json;
    assert.ok(recentActivity.length <= 5);
    assert.deepEqual(recentActivity[0], await latestActivity());
  });

  it("starts each week on a Monday", () => {
    assert.deepEqual(lastWeekStarts(new Date("2026-11-11T12:00:00Z"), 3), ["2026-10-26", "2026-11-02", "2026-11-09"]);
    assert.deepEqual(lastWeekStarts(new Date("2026-11-15T23:00:00Z"), 1), ["2026-11-09"]);
    assert.deepEqual(lastWeekStarts(new Date("2026-11-16T00:00:00Z"), 1), ["2026-11-16"]);
  });
});
