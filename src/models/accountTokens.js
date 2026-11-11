// One-time tokens for emailed links: password resets and email confirmation.
//
// The email contains the token; the database only keeps a hash of it. Anyone
// who steals the database still can't build a working link.

import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/database.js";

export const PASSWORD_RESET = "password_reset";
export const EMAIL_CONFIRMATION = "email_confirmation";
export const EMAIL_CHANGE = "email_change";

const HOUR = 60 * 60 * 1000;
const LIFETIME_MS = {
  [PASSWORD_RESET]: HOUR,
  [EMAIL_CONFIRMATION]: 24 * HOUR,
  [EMAIL_CHANGE]: 24 * HOUR,
};

const deleteExpired = db.prepare("DELETE FROM account_tokens WHERE expires_at <= ?");
const deleteForUser = db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?");
const insertToken = db.prepare(`
  INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
  VALUES (?, ?, ?, ?)
`);

// One statement that checks and removes the token together, so a token can
// never be used twice, even by two requests arriving at the same moment.
const takeToken = db.prepare(`
  DELETE FROM account_tokens
  WHERE token_hash = ? AND purpose = ? AND expires_at > ?
  RETURNING user_id
`);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Creates a token, cancelling any earlier one for the same purpose.
export function createAccountToken(userId, purpose) {
  const now = Date.now();
  deleteExpired.run(new Date(now).toISOString());
  deleteForUser.run(userId, purpose);

  const token = randomBytes(32).toString("base64url"); // 256 random bits
  insertToken.run(hashToken(token), userId, purpose, new Date(now + LIFETIME_MS[purpose]).toISOString());
  return token;
}

// Uses up the token. Returns the user's id, or null if it isn't valid.
export function consumeAccountToken(token, purpose) {
  if (typeof token !== "string" || !token) return null;
  const row = takeToken.get(hashToken(token), purpose, new Date().toISOString());
  return row ? row.user_id : null;
}
