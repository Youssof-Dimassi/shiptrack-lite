// Shipment data access.
//
// All the SQL for shipments lives here. The rest of the app calls these
// functions and doesn't need to know how or where the data is stored.

import { randomInt } from "node:crypto";
import { db, runInTransaction } from "../db/database.js";

// Tracking numbers look like "ST" followed by exactly 8 digits: ST10000001
export const TRACKING_NUMBER_PATTERN = /^ST\d{8}$/;

// The only statuses a shipment is allowed to have.
export const SHIPMENT_STATUSES = [
  "Pending",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
];

const findShipment = db.prepare(`
  SELECT id, tracking_number, status, origin, destination, estimated_delivery
  FROM shipments
  WHERE tracking_number = ?
`);

const findEvents = db.prepare(`
  SELECT occurred_at, location, description
  FROM shipment_events
  WHERE shipment_id = ?
  ORDER BY occurred_at, id
`);

// The filters only apply when given: a NULL value means "don't filter by this".
const MATCHES_FILTERS = `
  (:status IS NULL OR status = :status)
  AND (
    :pattern IS NULL
    OR tracking_number LIKE :pattern ESCAPE '\\'
    OR status          LIKE :pattern ESCAPE '\\'
    OR origin          LIKE :pattern ESCAPE '\\'
    OR destination     LIKE :pattern ESCAPE '\\'
  )
`;

const countMatching = db.prepare(`SELECT COUNT(*) AS count FROM shipments WHERE ${MATCHES_FILTERS}`);

const selectMatchingPage = db.prepare(`
  SELECT tracking_number, status, origin, destination, estimated_delivery
  FROM shipments
  WHERE ${MATCHES_FILTERS}
  ORDER BY id DESC
  LIMIT :limit OFFSET :offset
`);

const countByStatus = db.prepare("SELECT status, COUNT(*) AS count FROM shipments GROUP BY status");

const insertShipment = db.prepare(`
  INSERT INTO shipments (tracking_number, status, origin, destination, estimated_delivery)
  VALUES (?, 'Pending', ?, ?, ?)
`);

const insertEvent = db.prepare(`
  INSERT INTO shipment_events (shipment_id, occurred_at, location, description)
  VALUES (?, ?, ?, ?)
`);

const updateStatus = db.prepare("UPDATE shipments SET status = ? WHERE id = ?");

const updateDetails = db.prepare(`
  UPDATE shipments
  SET origin = ?, destination = ?, estimated_delivery = ?
  WHERE tracking_number = ?
`);

// Its history and customers' saved links go with it (ON DELETE CASCADE).
const removeShipment = db.prepare("DELETE FROM shipments WHERE tracking_number = ?");

// Database columns use snake_case (tracking_number); JavaScript uses
// camelCase (trackingNumber). This is the one place that converts them.
export function toShipment(row) {
  return {
    trackingNumber: row.tracking_number,
    status: row.status,
    origin: row.origin,
    destination: row.destination,
    estimatedDelivery: row.estimated_delivery,
  };
}

// Returns the shipment with its events, or null if it doesn't exist.
export function findShipmentByTrackingNumber(trackingNumber) {
  const row = findShipment.get(trackingNumber);
  if (!row) return null;

  return {
    ...toShipment(row),
    events: findEvents.all(row.id).map((e) => ({
      date: e.occurred_at,
      location: e.location,
      description: e.description,
    })),
  };
}

// One page of shipments, newest first, without their event history.
// Asking for a page past the end gives the last page.
export function searchShipments({ page, pageSize, search, status }) {
  // % and _ are wildcards in LIKE, so they're escaped to be searched for literally.
  const pattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const filters = { status, pattern };

  const total = countMatching.get(filters).count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);

  const rows = selectMatchingPage.all({ ...filters, limit: pageSize, offset: (currentPage - 1) * pageSize });

  const statusCounts = countByStatus.all();
  const counts = {
    all: statusCounts.reduce((sum, row) => sum + row.count, 0),
    byStatus: Object.fromEntries(statusCounts.map((row) => [row.status, row.count])),
  };

  return { shipments: rows.map(toShipment), page: currentPage, pageSize, total, totalPages, counts };
}

// Changes the details only. Status changes go through addShipmentUpdate, so
// they always leave an entry in the history.
// Returns the updated shipment, or null if the tracking number doesn't exist.
export function updateShipmentDetails(trackingNumber, { origin, destination, estimatedDelivery }) {
  const { changes } = updateDetails.run(origin, destination, estimatedDelivery, trackingNumber);
  return changes > 0 ? findShipmentByTrackingNumber(trackingNumber) : null;
}

// Returns true if the shipment existed and is now gone.
export function deleteShipment(trackingNumber) {
  return removeShipment.run(trackingNumber).changes > 0;
}

// Creates a shipment and its first history entry. Returns the new shipment.
export function createShipment({ origin, destination, estimatedDelivery }) {
  const trackingNumber = generateTrackingNumber();

  runInTransaction(() => {
    const { lastInsertRowid } = insertShipment.run(trackingNumber, origin, destination, estimatedDelivery);
    insertEvent.run(lastInsertRowid, new Date().toISOString(), origin, "Shipment created");
  });

  return findShipmentByTrackingNumber(trackingNumber);
}

// Sets a new status and records it in the history, as one all-or-nothing step.
// Returns the updated shipment, or null if the tracking number doesn't exist.
export function addShipmentUpdate(trackingNumber, { status, location, description }) {
  const row = findShipment.get(trackingNumber);
  if (!row) return null;

  runInTransaction(() => {
    updateStatus.run(status, row.id);
    insertEvent.run(row.id, new Date().toISOString(), location, description);
  });

  return findShipmentByTrackingNumber(trackingNumber);
}

// randomInt is cryptographically random, so numbers can't be predicted from
// one another. If a number is already taken, we simply try another.
function generateTrackingNumber() {
  for (;;) {
    const candidate = `ST${randomInt(10_000_000, 100_000_000)}`;
    if (!findShipment.get(candidate)) return candidate;
  }
}
