// ShipTrack Lite: web server
//
// This file starts a web server that:
//   1. Sends the files in /public (HTML, CSS) to the browser
//   2. Answers API requests under /api (JSON data)

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
