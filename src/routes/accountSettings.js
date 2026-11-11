// A customer's own account settings.
//
//   PUT    /api/account/profile               { name }                      → change your name
//   PUT    /api/account/password              { currentPassword, newPassword }
//   PUT    /api/account/email                 { email, password }           → emails a link to the NEW address
//   POST   /api/account/confirm-email-change  { token }                     → switches to the new address
//   DELETE /api/account                       { password }                  → deletes the account
//
// Changing the email or password, or deleting the account, needs the current
// password. A stolen login cookie alone isn't enough to take over an account.

import { Router } from "express";
import { SESSION_COOKIE, readCookie, requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { sendTooManyAttempts } from "../auth/rateLimiting.js";
import {
  sendEmailChangeConfirmation,
  sendEmailChangedNotice,
  sendPasswordChangedNotice,
} from "../email/accountEmails.js";
import { EMAIL_CHANGE, consumeAccountToken } from "../models/accountTokens.js";
import { consumeAttempt, refundAttempt } from "../models/rateLimits.js";
import { destroyOtherSessions } from "../models/sessions.js";
import {
  applyPendingEmail,
  countAdmins,
  deleteUser,
  findUserById,
  getPasswordHash,
  isEmailTaken,
  setPendingEmail,
  updateUserName,
  updateUserPassword,
} from "../models/users.js";
import { EMAIL_PATTERN, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, cookieOptions } from "./auth.js";

export const accountSettingsRouter = Router();

const WRONG_PASSWORD = "Your current password is incorrect.";

// --- Opened from the email link (you may not be logged in) -------------------

accountSettingsRouter.post("/confirm-email-change", (req, res) => {
  const userId = consumeAccountToken(req.body?.token, EMAIL_CHANGE);
  if (!userId) return res.status(400).json({ error: "This link is invalid or has expired." });

  const before = findUserById(userId);
  const outcome = applyPendingEmail(userId);

  if (outcome === "nothing_pending") return res.status(400).json({ error: "This link is invalid or has expired." });
  if (outcome === "taken") {
    return res.status(409).json({ error: "Another account started using that email in the meantime. Please choose a different one." });
  }

  // Tell the OLD address, in case someone else made this change.
  sendEmailChangedNotice({ name: before.name, oldEmail: before.email, newEmail: findUserById(userId).email });
  res.json({ message: "Your email address has been changed. Use the new one to log in." });
});

// --- Everything else needs a login ------------------------------------------

accountSettingsRouter.use(requireAuth);

accountSettingsRouter.put("/profile", (req, res) => {
  const name = cleanText(req.body?.name);
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Please enter your name (up to 100 characters)." });
  }

  updateUserName(req.user.id, name);
  res.json({ user: findUserById(req.user.id) });
});

accountSettingsRouter.put("/password", async (req, res) => {
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Your new password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    });
  }

  const check = await checkCurrentPassword(req, req.body?.currentPassword);
  if (check.blocked) return sendTooManyAttempts(res, check.retryAfterSeconds);
  if (!check.ok) return res.status(400).json({ error: WRONG_PASSWORD });

  updateUserPassword(req.user.id, await hashPassword(newPassword));

  // Anyone else logged in to this account (another device, or an attacker) is
  // logged out. This browser stays logged in.
  destroyOtherSessions(req.user.id, readCookie(req, SESSION_COOKIE));
  sendPasswordChangedNotice(req.user);

  res.json({ message: "Your password has been changed. Your other devices have been logged out." });
});

accountSettingsRouter.put("/email", async (req, res) => {
  const email = cleanText(req.body?.email).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (email === req.user.email) {
    return res.status(400).json({ error: "That's already your email address." });
  }

  const check = await checkCurrentPassword(req, req.body?.password);
  if (check.blocked) return sendTooManyAttempts(res, check.retryAfterSeconds);
  if (!check.ok) return res.status(400).json({ error: WRONG_PASSWORD });

  if (isEmailTaken(email)) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  // Nothing changes until the link sent to the new address is opened. A typo
  // can't lock you out, and nobody can move your account to an address they
  // don't control.
  setPendingEmail(req.user.id, email);
  sendEmailChangeConfirmation({ ...req.user, newEmail: email });

  res.json({ message: `We've sent a confirmation link to ${email}. Your email changes when you open it.` });
});

accountSettingsRouter.delete("/", async (req, res) => {
  const check = await checkCurrentPassword(req, req.body?.password);
  if (check.blocked) return sendTooManyAttempts(res, check.retryAfterSeconds);
  if (!check.ok) return res.status(400).json({ error: WRONG_PASSWORD });

  if (req.user.role === "admin" && countAdmins() <= 1) {
    return res.status(409).json({ error: "You're the only admin. Make someone else an admin before deleting your account." });
  }

  // Their sessions, saved shipments, and links go with it (ON DELETE CASCADE).
  deleteUser(req.user.id);

  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.status(204).end();
});

// --- Helpers ----------------------------------------------------------------

// Limited like logging in: 5 wrong passwords per 15 minutes per account.
// A correct password takes its attempt back.
async function checkCurrentPassword(req, password) {
  const rule = { key: `account-password:user:${req.user.id}`, limit: 5, windowMs: 15 * 60 * 1000 };
  const attempt = consumeAttempt([rule]);
  if (!attempt.allowed) return { blocked: true, retryAfterSeconds: attempt.retryAfterSeconds };

  const ok = typeof password === "string" && (await verifyPassword(password, getPasswordHash(req.user.id)));
  if (ok) refundAttempt(rule.key);
  return { ok };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
