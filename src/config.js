// Settings that depend on where the app is running.

export const isProduction = process.env.NODE_ENV === "production";

// Demo mode fills an empty database with sample shipments and shows a sample
// tracking number on the home page. It's on while developing and off in
// production, unless SEED_DEMO_DATA is set to "true" or "false" to override it.
export const demoMode = process.env.SEED_DEMO_DATA ? process.env.SEED_DEMO_DATA === "true" : !isProduction;

// The site's public address, used to build links in emails. It's a fixed
// setting on purpose: building links from the incoming request would let an
// attacker make a reset email point to their own website.
export const appUrl = (process.env.APP_URL ?? `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

export const emailFrom = process.env.EMAIL_FROM ?? "ShipTrack Lite <no-reply@shiptrack.example>";

export function chooseEmailTransport(env) {
  if (env.EMAIL_TRANSPORT === "memory") return "memory"; // automated tests
  if (env.SMTP_URL) return "smtp";
  return env.NODE_ENV === "production" ? "disabled" : "console";
}

export const emailTransport = chooseEmailTransport(process.env);

// Where contact form messages are sent.
export const contactEmail = process.env.CONTACT_EMAIL ?? "support@shiptrack.example";
