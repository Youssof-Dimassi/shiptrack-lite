// Shipment routes.
//
//   GET /api/shipments/:trackingNumber   → one shipment, 400 if badly formatted, 404 if not found

import { Router } from "express";
import { limitTrackingLookups } from "../auth/rateLimiting.js";
import { isShipmentSaved } from "../models/savedShipments.js";
import { TRACKING_NUMBER_PATTERN, findShipmentByTrackingNumber } from "../models/shipments.js";

export const shipmentsRouter = Router();


// ":trackingNumber" is a placeholder: for GET /api/shipments/ST10000001,
// req.params.trackingNumber is "ST10000001".
shipmentsRouter.get("/:trackingNumber", limitTrackingLookups, (req, res) => {
  // Clean up the input: remove spaces around it, make it uppercase.
  const trackingNumber = req.params.trackingNumber.trim().toUpperCase();

  // 1. Validate: never trust input from the browser.
  if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
    return res.status(400).json({
      error: "Invalid tracking number. It should look like ST12345678.",
    });
  }

  // 2. Look it up in the database.
  const shipment = findShipmentByTrackingNumber(trackingNumber);

  // 3. Not found → 404. Found → 200 with the shipment as JSON.
  if (!shipment) {
    return res.status(404).json({
      error: `No shipment found with tracking number ${trackingNumber}.`,
    });
  }

  // A logged-in customer also learns whether it's in their saved list.
  res.json(req.user ? { ...shipment, saved: isShipmentSaved(req.user.id, trackingNumber) } : shipment);
});
