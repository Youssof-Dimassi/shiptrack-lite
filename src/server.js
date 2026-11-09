// ShipTrack Lite: starts the web server.
//
// The application itself is built in app.js.

import { app } from "./app.js";
import { emailTransport, isProduction } from "./config.js";

// The port (the "door number") the server listens on.
// Hosting services set PORT themselves; on our computer we use 3000.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ShipTrack Lite is running at http://localhost:${PORT}`);
});

// Misconfiguration should be obvious the moment the server starts.
if (isProduction && emailTransport === "disabled") {
  console.warn("WARNING: SMTP_URL isn't set, so password reset and confirmation emails won't be sent.");
}
if (isProduction && !process.env.APP_URL) {
  console.warn("WARNING: APP_URL isn't set, so links in emails will point to localhost.");
}
