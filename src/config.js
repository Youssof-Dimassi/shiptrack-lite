// Settings that depend on where the app is running.

export const isProduction = process.env.NODE_ENV === "production";

// Demo mode fills an empty database with sample shipments and shows a sample
// tracking number on the home page. It's on while developing and off in
// production, unless SEED_DEMO_DATA is set to "true" or "false" to override it.
export const demoMode = process.env.SEED_DEMO_DATA ? process.env.SEED_DEMO_DATA === "true" : !isProduction;
