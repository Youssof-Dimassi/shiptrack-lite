// ShipTrack Lite: starts the web server.
//
// The application itself is built in app.js.

import { app } from "./app.js";
import { emailTransport, isProduction } from "./config.js";
import { startWorker } from "./jobs/worker.js";

// The port (the "door number") the server listens on.
// Hosting services set PORT themselves; on our computer we use 3000.
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`ShipTrack Lite is running at http://localhost:${PORT}`);
});

// Misconfiguration should be obvious the moment the server starts.
if (isProduction && emailTransport === "disabled") {
  console.warn("WARNING: SMTP_URL isn't set, so password reset and confirmation emails won't be sent.");
}
if (isProduction && !process.env.APP_URL) {
  console.warn("WARNING: APP_URL isn't set, so links in emails will point to localhost.");
}

// The background job worker runs inside the web server. Set RUN_JOBS=false to
// turn it off, for example when a separate worker process is used.
const stopWorker = process.env.RUN_JOBS === "false" ? null : startWorker();

// Finish cleanly when the server is told to stop (Ctrl + C, or a new deploy).
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopWorker?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
