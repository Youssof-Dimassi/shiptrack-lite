// Login sessions.
//
// When a user logs in, we create a long random secret (the "token"),
// give it to the browser in a cookie, and store a HASH of it here.
// On every request, the browser sends the cookie back and we look it up.

import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/database.js";

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const insertSession = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, expires_at)
  VALUES (?, ?, ?)
`);

const selectSession = db.prepare(`
  SELECT user_id
  FROM sessions
  WHERE token_hash = ? AND expires_at > ?
`);

const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
const deleteAllForUser = db.prepare("DELETE FROM sessions WHERE user_id = ?");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Creates a session and returns the token to put in the cookie.
export function createSession(userId) {
  deleteExpired.run(new Date().toISOString()); // tidy up old sessions

  const token = randomBytes(32).toString("base64url"); // 256 random bits
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  insertSession.run(hashToken(token), userId, expiresAt);
  return token;
}

// Returns the user id for a valid, unexpired token, otherwise null.
export function findUserIdBySessionToken(token) {
  const row = selectSession.get(hashToken(token), new Date().toISOString());
  return row ? row.user_id : null;
}

export function destroySession(token) {
  deleteSession.run(hashToken(token));
}

export function destroyAllSessionsForUser(userId) {
  deleteAllForUser.run(userId);
}
