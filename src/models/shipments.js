// Shipment data access.
//
// All the SQL for shipments lives here. The rest of the app just calls
// findShipmentByTrackingNumber(...) and doesn't need to know how or where
// the data is stored.

import { db } from "../db/database.js";

const findShipment = db.prepare(`
  SELECT id, tracking_number, status, origin, destination, estimated_delivery
  FROM shipments
  WHERE tracking_number = ?
`);

const findEvents = db.prepare(`
  SELECT occurred_at, location, description
  FROM shipment_events
  WHERE shipment_id = ?
  ORDER BY occurred_at
`);

// Returns the shipment with its events, or null if it doesn't exist.
export function findShipmentByTrackingNumber(trackingNumber) {
  const row = findShipment.get(trackingNumber);
  if (!row) return null;

  const events = findEvents.all(row.id);

  // Database columns use snake_case (tracking_number); JavaScript uses
  // camelCase (trackingNumber). We convert here so the API response stays
  // exactly the same as before, and app.js doesn't need to change.
  return {
    trackingNumber: row.tracking_number,
    status: row.status,
    origin: row.origin,
    destination: row.destination,
    estimatedDelivery: row.estimated_delivery,
    events: events.map((e) => ({
      date: e.occurred_at,
      location: e.location,
      description: e.description,
    })),
  };
}
