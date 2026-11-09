// Staff-only routes for managing shipments.
//
//   GET  /api/admin/shipments                       → list shipments
//   POST /api/admin/shipments                       → create a shipment
//   POST /api/admin/shipments/:trackingNumber/events → post a status update

import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
  SHIPMENT_STATUSES,
  TRACKING_NUMBER_PATTERN,
  addShipmentUpdate,
  createShipment,
  listShipments,
} from "../models/shipments.js";

export const adminRouter = Router();

const MAX_PLACE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;

// Every route in this file sits behind these two checks. Because they are
// applied here, a new route added below can't forget them.
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/shipments", (req, res) => {
  res.json({ shipments: listShipments(), statuses: SHIPMENT_STATUSES });
});

adminRouter.post("/shipments", (req, res) => {
  const origin = cleanText(req.body?.origin);
  const destination = cleanText(req.body?.destination);
  const estimatedDelivery = cleanText(req.body?.estimatedDelivery);

  if (!isValidPlace(origin)) return badRequest(res, placeError("origin"));
  if (!isValidPlace(destination)) return badRequest(res, placeError("destination"));
  if (!isRealDate(estimatedDelivery)) return badRequest(res, "Please enter a valid estimated delivery date.");

  const shipment = createShipment({ origin, destination, estimatedDelivery });
  res.status(201).json({ shipment });
});

adminRouter.post("/shipments/:trackingNumber/events", (req, res) => {
  const trackingNumber = req.params.trackingNumber.trim().toUpperCase();
  const status = cleanText(req.body?.status);
  const location = cleanText(req.body?.location);
  const description = cleanText(req.body?.description);

  if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) return badRequest(res, "Invalid tracking number.");
  if (!SHIPMENT_STATUSES.includes(status)) return badRequest(res, "Please choose a valid status.");
  if (!isValidPlace(location)) return badRequest(res, placeError("location"));
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    return badRequest(res, `Please enter a description (up to ${MAX_DESCRIPTION_LENGTH} characters).`);
  }

  const shipment = addShipmentUpdate(trackingNumber, { status, location, description });
  if (!shipment) {
    return res.status(404).json({ error: `No shipment found with tracking number ${trackingNumber}.` });
  }

  res.status(201).json({ shipment });
});

// --- Helpers ----------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidPlace(value) {
  return value.length > 0 && value.length <= MAX_PLACE_LENGTH;
}

function placeError(field) {
  return `Please enter the ${field} (up to ${MAX_PLACE_LENGTH} characters).`;
}

// Checks the format AND that the date exists. new Date("2026-02-31") rolls
// over to March 3, so we convert it back and make sure it's unchanged.
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
