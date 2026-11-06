// ShipTrack Lite: web server
//
// This file starts a web server that:
//   1. Sends the files in /public (HTML, CSS) to the browser
//   2. Answers API requests under /api (JSON data)

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shipments } from "./data/shipments.js";

// --- Settings -------------------------------------------------------------

// The port (the "door number") the server listens on.
// Hosting services set PORT themselves; on our computer we use 3000.
const PORT = process.env.PORT || 3000;

// Find the absolute path of the /public folder, no matter where the
// server is started from.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(currentDir, "..", "public");

// --- Create the app -------------------------------------------------------

const app = express();

// --- API routes -----------------------------------------------------------

// Health check: a tiny route that answers "I'm alive".
// Real systems call this to check the server is running.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Tracking numbers look like "ST" followed by exactly 8 digits: ST10000001
const TRACKING_NUMBER_PATTERN = /^ST\d{8}$/;

// Look up one shipment by its tracking number.
// ":trackingNumber" is a placeholder: for GET /api/shipments/ST10000001,
// req.params.trackingNumber is "ST10000001".
app.get("/api/shipments/:trackingNumber", (req, res) => {
  // Clean up the input: remove spaces around it, make it uppercase.
  const trackingNumber = req.params.trackingNumber.trim().toUpperCase();

  // 1. Validate: never trust input from the browser.
  if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
    return res.status(400).json({
      error: "Invalid tracking number. It should look like ST12345678.",
    });
  }

  // 2. Look it up.
  const shipment = shipments.find((s) => s.trackingNumber === trackingNumber);

  // 3. Not found → 404. Found → 200 with the shipment as JSON.
  if (!shipment) {
    return res.status(404).json({
      error: `No shipment found with tracking number ${trackingNumber}.`,
    });
  }

  res.json(shipment);
});

// Any other /api address that doesn't exist: answer in JSON, not HTML,
// because API callers expect JSON.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// --- Static files ---------------------------------------------------------

// Any request that isn't an API route: look for a matching file in /public.
//   GET /           → public/index.html
//   GET /style.css  → public/style.css
app.use(express.static(publicDir));

// --- Not found (404) ------------------------------------------------------

// If nothing above matched, the page doesn't exist.
app.use((req, res) => {
  res.status(404).send("404 - Page not found");
});

// --- Start ----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`ShipTrack Lite is running at http://localhost:${PORT}`);
});
