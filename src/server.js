// ShipTrack Lite: starts the web server.
//
// The application itself is built in app.js.

import { app } from "./app.js";

// The port (the "door number") the server listens on.
// Hosting services set PORT themselves; on our computer we use 3000.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ShipTrack Lite is running at http://localhost:${PORT}`);
});
