// Staff-only routes for managing shipments.
//
//   GET    /api/admin/shipments?page=&search=&status= → one page of shipments
//   POST   /api/admin/shipments                       → create a shipment
//   PUT    /api/admin/shipments/:trackingNumber       → edit its details
//   DELETE /api/admin/shipments/:trackingNumber       → delete it
//   POST   /api/admin/shipments/:trackingNumber/events → post a status update

import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
  SHIPMENT_STATUSES,
  TRACKING_NUMBER_PATTERN,
  addShipmentUpdate,
  createShipment,
  deleteShipment,
  searchShipments,
  updateShipmentDetails,
} from "../models/shipments.js";

export const adminRouter = Router();

const PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 100;
const MAX_PLACE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;

// Every route in this file sits behind these two checks. Because they are
// applied here, a new route added below can't forget them.
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/shipments", (req, res) => {
  const { page: pageText = "1", search: searchText = "", status } = req.query;

  // Query values are whatever the address says, so they get checked too.
  // Repeating a value in the address (?page=1&page=2) produces a list, not text.
  if (typeof pageText !== "string" || !/^[1-9]\d{0,8}$/.test(pageText)) {
    return badRequest(res, "Invalid page number.");
  }
  if (typeof searchText !== "string" || searchText.length > MAX_SEARCH_LENGTH) {
    return badRequest(res, `Search text can be up to ${MAX_SEARCH_LENGTH} characters.`);
  }
  if (status !== undefined && !SHIPMENT_STATUSES.includes(status)) {
    return badRequest(res, "Please choose a valid status.");
  }

  const results = searchShipments({
    page: Number(pageText),
    pageSize: PAGE_SIZE,
    search: searchText.trim(),
    status: status ?? null,
  });

  res.json({ ...results, statuses: SHIPMENT_STATUSES });
});

adminRouter.post("/shipments", (req, res) => {
  const { details, error } = readShipmentDetails(req.body);
  if (error) return badRequest(res, error);

  res.status(201).json({ shipment: createShipment(details) });
});

adminRouter.put("/shipments/:trackingNumber", (req, res) => {
  const trackingNumber = readTrackingNumber(req);
  if (!trackingNumber) return badRequest(res, "Invalid tracking number.");

  const { details, error } = readShipmentDetails(req.body);
  if (error) return badRequest(res, error);

  const shipment = updateShipmentDetails(trackingNumber, details);
  if (!shipment) return notFound(res, trackingNumber);

  res.json({ shipment });
});

adminRouter.delete("/shipments/:trackingNumber", (req, res) => {
  const trackingNumber = readTrackingNumber(req);
  if (!trackingNumber) return badRequest(res, "Invalid tracking number.");

  if (!deleteShipment(trackingNumber)) return notFound(res, trackingNumber);

  res.status(204).end();
});

adminRouter.post("/shipments/:trackingNumber/events", (req, res) => {
  const trackingNumber = readTrackingNumber(req);
  const status = cleanText(req.body?.status);
  const location = cleanText(req.body?.location);
  const description = cleanText(req.body?.description);

  if (!trackingNumber) return badRequest(res, "Invalid tracking number.");
  if (!SHIPMENT_STATUSES.includes(status)) return badRequest(res, "Please choose a valid status.");
  if (!isValidPlace(location)) return badRequest(res, placeError("location"));
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    return badRequest(res, `Please enter a description (up to ${MAX_DESCRIPTION_LENGTH} characters).`);
  }

  const shipment = addShipmentUpdate(trackingNumber, { status, location, description });
  if (!shipment) return notFound(res, trackingNumber);

  res.status(201).json({ shipment });
});

// --- Helpers ----------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function notFound(res, trackingNumber) {
  return res.status(404).json({ error: `No shipment found with tracking number ${trackingNumber}.` });
}

// Returns the cleaned-up number, or null if it's not a valid tracking number.
function readTrackingNumber(req) {
  const trackingNumber = req.params.trackingNumber.trim().toUpperCase();
  return TRACKING_NUMBER_PATTERN.test(trackingNumber) ? trackingNumber : null;
}

// Creating and editing accept exactly the same fields, so they share these
// checks. Only the listed fields are read: anything else in the request,
// such as a different tracking number or status, is ignored.
function readShipmentDetails(body) {
  const origin = cleanText(body?.origin);
  const destination = cleanText(body?.destination);
  const estimatedDelivery = cleanText(body?.estimatedDelivery);

  if (!isValidPlace(origin)) return { error: placeError("origin") };
  if (!isValidPlace(destination)) return { error: placeError("destination") };
  if (!isRealDate(estimatedDelivery)) return { error: "Please enter a valid estimated delivery date." };

  return { details: { origin, destination, estimatedDelivery } };
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
