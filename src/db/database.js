// Database connection and setup.
//
// SQLite keeps the whole database in ONE file (shiptrack.db by default).
// Node.js has SQLite built in (the "node:sqlite" module), so nothing extra
// needs to be installed.

import { DatabaseSync } from "node:sqlite";
import { seedDatabase } from "./seed.js";

// Where the database file lives. Can be changed with the DATABASE_PATH
// environment variable (useful later for tests and hosting).
const DATABASE_PATH = process.env.DATABASE_PATH || "shiptrack.db";

// Open the file (SQLite creates it if it doesn't exist yet).
export const db = new DatabaseSync(DATABASE_PATH);

// Make SQLite enforce the links between tables (see "REFERENCES" below).
db.exec("PRAGMA foreign_keys = ON;");

// --- Tables -----------------------------------------------------------------
//
// A table is like a spreadsheet: columns are fixed, each row is one record.
// "IF NOT EXISTS" means: only create it the first time.
//
// We use TWO tables because one shipment has MANY events:
//
//   shipments                         shipment_events
//   ┌────┬─────────────┬─────────┐    ┌────┬─────────────┬──────────────────┐
//   │ id │ tracking_no │ status  │    │ id │ shipment_id │ description      │
//   ├────┼─────────────┼─────────┤    ├────┼─────────────┼──────────────────┤
//   │ 1  │ ST10000001  │ In Tr.. │◀───│ 1  │ 1           │ Shipment created │
//   └────┴─────────────┴─────────┘ ◀──│ 2  │ 1           │ Picked up        │
//                                      └────┴─────────────┴──────────────────┘

db.exec(`
  CREATE TABLE IF NOT EXISTS shipments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number    TEXT    NOT NULL UNIQUE,
    status             TEXT    NOT NULL,
    origin             TEXT    NOT NULL,
    destination        TEXT    NOT NULL,
    estimated_delivery TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shipment_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    occurred_at TEXT    NOT NULL,
    location    TEXT    NOT NULL,
    description TEXT    NOT NULL
  );
`);

// Fill the database with sample shipments the first time it is created.
seedDatabase(db);
