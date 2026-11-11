// User data access.

import { randomBytes } from "node:crypto";
import { db } from "../db/database.js";

const insertUser = db.prepare(`
  INSERT INTO users (name, email, password_hash)
  VALUES (?, ?, ?)
`);

const selectByEmail = db.prepare(`
  SELECT id, name, email, password_hash, role, email_confirmed_at
  FROM users
  WHERE email = ?
`);

const selectById = db.prepare(`
  SELECT id, name, email, role, email_confirmed_at, notify_shipment_updates, pending_email
  FROM users
  WHERE id = ?
`);

const updateRoleByEmail = db.prepare("UPDATE users SET role = ? WHERE email = ?");

const updatePassword = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");

// Keeps the original time if the email was already confirmed.
const confirmEmail = db.prepare("UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?");

export function updateUserPassword(userId, passwordHash) {
  updatePassword.run(passwordHash, userId);
}

export function markEmailConfirmed(userId) {
  confirmEmail.run(new Date().toISOString(), userId);
}

const updateNotify = db.prepare("UPDATE users SET notify_shipment_updates = ? WHERE id = ?");
const selectUnsubscribeToken = db.prepare("SELECT unsubscribe_token FROM users WHERE id = ?");
const setUnsubscribeToken = db.prepare("UPDATE users SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL");
const unsubscribeByToken = db.prepare("UPDATE users SET notify_shipment_updates = 0 WHERE unsubscribe_token = ?");

export function setShipmentUpdateEmails(userId, enabled) {
  updateNotify.run(enabled ? 1 : 0, userId);
}

// Each user has one random unsubscribe code, made the first time it's needed
// and reused in every email, so any of their emails' links keeps working. It
// can only turn update emails off, nothing else.
export function getUnsubscribeToken(userId) {
  const existing = selectUnsubscribeToken.get(userId)?.unsubscribe_token;
  if (existing) return existing;
  setUnsubscribeToken.run(randomBytes(24).toString("base64url"), userId);
  return selectUnsubscribeToken.get(userId).unsubscribe_token;
}

// Returns true if the token belonged to someone.
export function unsubscribeWithToken(token) {
  if (typeof token !== "string" || !token) return false;
  return unsubscribeByToken.run(token).changes > 0;
}

// Returns true if a user with that email existed and was updated.
export function setUserRole(email, role) {
  return updateRoleByEmail.run(role, email).changes > 0;
}

// Returns the new user's id.
export function createUser({ name, email, passwordHash }) {
  const { lastInsertRowid } = insertUser.run(name, email, passwordHash);
  return Number(lastInsertRowid);
}

// Includes password_hash: only used by the login code to check a password.
export function findUserByEmailWithPassword(email) {
  return selectByEmail.get(email) ?? null;
}

// Safe to send to the browser: no password hash.
export function findUserById(id) {
  const row = selectById.get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    emailConfirmed: Boolean(row.email_confirmed_at),
    notifyShipmentUpdates: Boolean(row.notify_shipment_updates),
    pendingEmail: row.pending_email,
  };
}

// --- Account settings ---------------------------------------------------------

const selectPasswordHash = db.prepare("SELECT password_hash FROM users WHERE id = ?");
const updateName = db.prepare("UPDATE users SET name = ? WHERE id = ?");
const updatePendingEmail = db.prepare("UPDATE users SET pending_email = ? WHERE id = ?");
const selectByExactEmail = db.prepare("SELECT id FROM users WHERE email = ?");
const switchToPendingEmail = db.prepare(`
  UPDATE users
  SET email = pending_email, pending_email = NULL, email_confirmed_at = ?
  WHERE id = ? AND pending_email IS NOT NULL
`);
const removeUser = db.prepare("DELETE FROM users WHERE id = ?");
const countAdminUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
const updateRoleById = db.prepare("UPDATE users SET role = ? WHERE id = ?");

// Only for checking a password: never sent anywhere.
export function getPasswordHash(userId) {
  return selectPasswordHash.get(userId)?.password_hash ?? "";
}

export function updateUserName(userId, name) {
  updateName.run(name, userId);
}

export function isEmailTaken(email) {
  return Boolean(selectByExactEmail.get(email));
}

export function setPendingEmail(userId, email) {
  updatePendingEmail.run(email, userId);
}

// Switches to the confirmed new address. Opening the link proves it's theirs,
// so it counts as confirmed. Returns "changed", "nothing_pending", or "taken"
// (another account started using that address in the meantime).
export function applyPendingEmail(userId) {
  try {
    const { changes } = switchToPendingEmail.run(new Date().toISOString(), userId);
    return changes > 0 ? "changed" : "nothing_pending";
  } catch (error) {
    if (/UNIQUE/.test(error.message)) return "taken";
    throw error;
  }
}

// Their sessions, saved shipments, and links are deleted with them
// (ON DELETE CASCADE). Activity log entries keep the copied name (SET NULL).
export function deleteUser(userId) {
  removeUser.run(userId);
}

export function countAdmins() {
  return countAdminUsers.get().count;
}

export function setUserRoleById(userId, role) {
  updateRoleById.run(role, userId);
}

// --- Listing users for staff -------------------------------------------------

const MATCHES_SEARCH = "(:pattern IS NULL OR name LIKE :pattern ESCAPE '\\' OR email LIKE :pattern ESCAPE '\\')";
const countMatchingUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${MATCHES_SEARCH}`);
const selectMatchingUsers = db.prepare(`
  SELECT u.id, u.name, u.email, u.role, u.email_confirmed_at, u.created_at,
         (SELECT COUNT(*) FROM saved_shipments s WHERE s.user_id = u.id) AS saved_shipments
  FROM users u
  WHERE ${MATCHES_SEARCH}
  ORDER BY u.id DESC
  LIMIT :limit OFFSET :offset
`);

export function listUsers({ page = 1, pageSize = 20, search = "" } = {}) {
  // % and _ are wildcards in LIKE, so they're escaped to be searched for literally.
  const pattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const total = countMatchingUsers.get({ pattern }).count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = selectMatchingUsers.all({ pattern, limit: pageSize, offset: (currentPage - 1) * pageSize });

  return {
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      emailConfirmed: Boolean(row.email_confirmed_at),
      savedShipments: row.saved_shipments,
      createdAt: `${row.created_at.replace(" ", "T")}Z`, // SQLite's datetime('now') is UTC
    })),
    page: currentPage,
    pageSize,
    total,
    totalPages,
  };
}
