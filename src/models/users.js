// User data access.

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
  SELECT id, name, email, role, email_confirmed_at
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
  return { id: row.id, name: row.name, email: row.email, role: row.role, emailConfirmed: Boolean(row.email_confirmed_at) };
}
