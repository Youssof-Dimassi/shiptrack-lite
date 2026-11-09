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

// How many shipments the admin list returns at most.
const LIST_LIMIT = 200;

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

const selectRecentShipments = db.prepare(`
  SELECT id, tracking_number, status, origin, destination, estimated_delivery
  FROM shipments
  ORDER BY id DESC
  LIMIT ?
`);

const insertShipment = db.prepare(`
  INSERT INTO shipments (tracking_number, status, origin, destination, estimated_delivery)
  VALUES (?, 'Pending', ?, ?, ?)
`);

const insertEvent = db.prepare(`
  INSERT INTO shipment_events (shipment_id, occurred_at, location, description)
  VALUES (?, ?, ?, ?)
`);

const updateStatus = db.prepare("UPDATE shipments SET status = ? WHERE id = ?");

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

// Newest first, without the event history (the admin table doesn't need it).
export function listShipments() {
  return selectRecentShipments.all(LIST_LIMIT).map(toShipment);
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
