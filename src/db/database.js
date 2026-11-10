// Database connection and setup.
//
// SQLite keeps the whole database in ONE file (shiptrack.db by default).
// Node.js has SQLite built in (the "node:sqlite" module), so nothing extra
// needs to be installed.

import { DatabaseSync } from "node:sqlite";
import { demoMode } from "../config.js";
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

  -- People who can log in.
  -- We NEVER store the password itself, only a one-way hash of it.
  -- role is "customer" or "admin" (admins will manage shipments in Step 6).
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Counters that stop people from trying things endlessly (see models/rateLimits.js).
  -- reset_at is a time in milliseconds.
  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket   TEXT    PRIMARY KEY,
    hits     INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  -- Shipments a customer has saved to their account.
  CREATE TABLE IF NOT EXISTS saved_shipments (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    saved_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, shipment_id)
  );

  -- One-time links sent by email. Only a hash of each token is kept.
  CREATE TABLE IF NOT EXISTS account_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT    NOT NULL CHECK (purpose IN ('password_reset', 'email_confirmation')),
    expires_at TEXT    NOT NULL
  );

  -- Background jobs (see src/jobs/queue.js). Times are in milliseconds.
  CREATE TABLE IF NOT EXISTS jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT    NOT NULL,
    payload      TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    run_at       INTEGER NOT NULL,
    locked_at    INTEGER,
    last_error   TEXT,
    created_at   INTEGER NOT NULL,
    finished_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, run_at);

  -- One row per logged-in browser.
  -- token_hash is a hash of the secret stored in the user's cookie, so a
  -- stolen copy of the database can't be used to log in as anyone.
  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );
`);

// Runs several database changes as one: if any of them fails, none are saved.
// A transaction started inside another one simply joins it, so functions that
// use transactions can be combined into one bigger all-or-nothing change.
let transactionDepth = 0;

export function runInTransaction(work) {
  if (transactionDepth > 0) return work();

  db.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}

// --- Upgrades ---------------------------------------------------------------
//
// "CREATE TABLE IF NOT EXISTS" can't add a column to a table that already
// exists, so changes to existing tables are listed here, in order. The database
// remembers how many it has applied (user_version), so each one runs only once.
// Never edit or remove an entry: add a new one at the end.
const MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN email_confirmed_at TEXT",
  "ALTER TABLE users ADD COLUMN notify_shipment_updates INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN unsubscribe_token TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_unsubscribe_token ON users (unsubscribe_token)",
];

const { user_version: appliedMigrations } = db.prepare("PRAGMA user_version").get();

for (let index = appliedMigrations; index < MIGRATIONS.length; index += 1) {
  runInTransaction(() => {
    db.exec(MIGRATIONS[index]);
    db.exec(`PRAGMA user_version = ${index + 1}`);
  });
}

// In demo mode, fill an empty database with sample shipments.
if (demoMode) seedDatabase(db);
