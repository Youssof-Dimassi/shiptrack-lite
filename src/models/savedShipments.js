// The shipments each customer has saved to their account.
//
// Saving needs the tracking number, and anyone with that number can already
// view the shipment, so saving never reveals anything new.

import { db } from "../db/database.js";
import { toShipment } from "./shipments.js";

export const MAX_SAVED_SHIPMENTS = 100;

const selectShipmentId = db.prepare("SELECT id FROM shipments WHERE tracking_number = ?");
const countSaved = db.prepare("SELECT COUNT(*) AS count FROM saved_shipments WHERE user_id = ?");
const selectLink = db.prepare("SELECT 1 FROM saved_shipments WHERE user_id = ? AND shipment_id = ?");
const insertLink = db.prepare("INSERT INTO saved_shipments (user_id, shipment_id) VALUES (?, ?)");
const deleteLink = db.prepare("DELETE FROM saved_shipments WHERE user_id = ? AND shipment_id = ?");

// Each shipment comes with the most recent entry from its history.
const selectSaved = db.prepare(`
  SELECT s.tracking_number, s.status, s.origin, s.destination, s.estimated_delivery,
         latest.description AS latest_description,
         latest.location    AS latest_location
  FROM saved_shipments saved
  JOIN shipments s ON s.id = saved.shipment_id
  LEFT JOIN shipment_events latest ON latest.id = (
    SELECT e.id FROM shipment_events e
    WHERE e.shipment_id = s.id
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 1
  )
  WHERE saved.user_id = ?
  ORDER BY saved.saved_at DESC, saved.shipment_id DESC
`);

export function listSavedShipments(userId) {
  return selectSaved.all(userId).map((row) => ({
    ...toShipment(row),
    latestUpdate: row.latest_description
      ? { description: row.latest_description, location: row.latest_location }
      : null,
  }));
}

export function isShipmentSaved(userId, trackingNumber) {
  const shipment = selectShipmentId.get(trackingNumber);
  return Boolean(shipment && selectLink.get(userId, shipment.id));
}

// Returns "saved", "already_saved", "not_found", or "limit_reached".
export function saveShipment(userId, trackingNumber) {
  const shipment = selectShipmentId.get(trackingNumber);
  if (!shipment) return "not_found";
  if (selectLink.get(userId, shipment.id)) return "already_saved";
  if (countSaved.get(userId).count >= MAX_SAVED_SHIPMENTS) return "limit_reached";

  insertLink.run(userId, shipment.id);
  return "saved";
}

// Returns true if the shipment was saved and is now removed.
export function removeSavedShipment(userId, trackingNumber) {
  const shipment = selectShipmentId.get(trackingNumber);
  if (!shipment) return false;
  return deleteLink.run(userId, shipment.id).changes > 0;
}
