// A logged-in customer's saved shipments.
//
//   GET    /api/my-shipments                  → the customer's saved shipments
//   POST   /api/my-shipments { trackingNumber } → save a shipment
//   DELETE /api/my-shipments/:trackingNumber  → remove it from the list

import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { limitTrackingLookups } from "../auth/rateLimiting.js";
import { TRACKING_NUMBER_PATTERN } from "../models/shipments.js";
import {
  MAX_SAVED_SHIPMENTS,
  listSavedShipments,
  removeSavedShipment,
  saveShipment,
} from "../models/savedShipments.js";

export const myShipmentsRouter = Router();

myShipmentsRouter.use(requireAuth);

// Everything below uses req.user.id, never an id sent by the browser, so a
// customer can only ever reach their own list.
myShipmentsRouter.get("/", (req, res) => {
  res.json({ shipments: listSavedShipments(req.user.id) });
});

myShipmentsRouter.post("/", limitTrackingLookups, (req, res) => {
  const trackingNumber = normalize(req.body?.trackingNumber);
  if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
    return res.status(400).json({ error: "Invalid tracking number. It should look like ST12345678." });
  }

  const outcome = saveShipment(req.user.id, trackingNumber);

  if (outcome === "not_found") {
    return res.status(404).json({ error: `No shipment found with tracking number ${trackingNumber}.` });
  }
  if (outcome === "limit_reached") {
    return res.status(409).json({ error: `You can save up to ${MAX_SAVED_SHIPMENTS} shipments. Remove one first.` });
  }

  // Saving something that's already saved isn't an error: the result is the same.
  res.status(outcome === "saved" ? 201 : 200).json({ trackingNumber });
});

myShipmentsRouter.delete("/:trackingNumber", (req, res) => {
  const removed = removeSavedShipment(req.user.id, normalize(req.params.trackingNumber));
  if (!removed) return res.status(404).json({ error: "That shipment isn't in your list." });
  res.status(204).end();
});

function normalize(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
