// Databases created by older versions of the app must upgrade safely.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

function openApp(databasePath) {
  // Any script that loads the database applies the upgrades.
  return spawnSync(process.execPath, ["src/scripts/make-admin.js", "sam@example.com"], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
}

describe("upgrading an older database", () => {
  it("adds new columns, keeps existing users, and is safe to repeat", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "shiptrack-migrate-"));
    const databasePath = path.join(folder, "old.db");

    try {
      const old = new DatabaseSync(databasePath);
      old.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'customer',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (name, email, password_hash) VALUES ('Sam', 'sam@example.com', 'x');
      `);
      old.close();

      assert.equal(openApp(databasePath).status, 0);
      assert.equal(openApp(databasePath).status, 0);

      const upgraded = new DatabaseSync(databasePath);
      const user = upgraded.prepare("SELECT role, email_confirmed_at FROM users WHERE email = 'sam@example.com'").get();
      const { user_version: version } = upgraded.prepare("PRAGMA user_version").get();
      upgraded.close();

      assert.equal(user.role, "admin");
      assert.equal(user.email_confirmed_at, null);
      assert.equal(version, 6);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
