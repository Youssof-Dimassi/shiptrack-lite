// ShipTrack Lite: the application
//
// This file builds the app and connects all the pieces, in order.
// Express runs them TOP TO BOTTOM for every request, until one answers.
//
//   1. Read JSON bodies and the login cookie   (middleware)
//   2. API routes under /api                   (JSON data)
//   3. Files in /public                        (HTML, CSS, browser JS)
//   4. 404 if nothing matched
//   5. 500 if something crashed
//
// It does NOT start listening: server.js does that. Keeping them apart lets
// the automated tests run this same app on a temporary port.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUser } from "./auth/middleware.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { shipmentsRouter } from "./routes/shipments.js";

// Find the absolute path of the /public folder, no matter where the
// server is started from.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(currentDir, "..", "public");

export const app = express();

// How many proxy servers sit in front of this app. Hosting services usually
// add one, and then the visitor's real address is in the X-Forwarded-For
// header. The default is 0, because without a proxy anyone could fake that
// header and appear to be a new visitor on every request.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 0));

// --- 1. Middleware --------------------------------------------------------

// Turn JSON request bodies (sent by forms via fetch) into req.body.
// The size limit stops anyone from sending us huge requests.
app.use(express.json({ limit: "10kb" }));

// Find out who is logged in (sets req.user, or null).
app.use(loadUser);

// --- 2. API routes --------------------------------------------------------

// Health check: a tiny route that answers "I'm alive".
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/shipments", shipmentsRouter);
app.use("/api/admin", adminRouter);

// Any other /api address that doesn't exist: answer in JSON, not HTML,
// because API callers expect JSON.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// --- 3. Static files ------------------------------------------------------

// Any other request: look for a matching file in /public.
//   GET /            → public/index.html
//   GET /login.html  → public/login.html
// "extensions" also lets /login work without typing ".html".
app.use(express.static(publicDir, { extensions: ["html"] }));

// --- 4. Not found (404) ---------------------------------------------------

app.use((req, res) => {
  res.status(404).send("404 - Page not found");
});

// --- 5. Server error (500) ------------------------------------------------

// Express sends any crash here (functions with 4 arguments are error handlers).
// We log the details for ourselves, but never show them to the visitor:
// error details can reveal how the server works to an attacker.
app.use((error, req, res, next) => {
  // Errors with a 4xx status (e.g. broken JSON, a body that's too big) are
  // the visitor's mistake, not a crash on our side.
  if (error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: "Invalid request." });
  }

  console.error(error);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});
