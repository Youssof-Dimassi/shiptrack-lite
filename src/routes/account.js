// Password reset and email confirmation.
//
//   POST /api/auth/forgot-password       { email }           → emails a reset link
//   POST /api/auth/reset-password        { token, password } → sets a new password
//   POST /api/auth/confirm-email         { token }           → confirms the email
//   POST /api/auth/resend-confirmation                       → emails a new link

import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword } from "../auth/passwords.js";
import { sendTooManyAttempts } from "../auth/rateLimiting.js";
import { sendConfirmationEmail, sendPasswordResetEmail } from "../email/accountEmails.js";
import { EMAIL_CONFIRMATION, PASSWORD_RESET, consumeAccountToken } from "../models/accountTokens.js";
import { consumeAttempt, resetAttempts } from "../models/rateLimits.js";
import { destroyAllSessionsForUser } from "../models/sessions.js";
import {
  findUserByEmailWithPassword,
  findUserById,
  markEmailConfirmed,
  updateUserPassword,
} from "../models/users.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, loginLimits } from "./auth.js";

export const accountRouter = Router();

const HOUR = 60 * 60 * 1000;
const INVALID_LINK = "This link is invalid or has expired.";

// Stops one address from flooding the server with requests.
function limitByAddress(name, limit) {
  return (req, res, next) => {
    const attempt = consumeAttempt([{ key: `${name}:ip:${req.ip}`, limit, windowMs: HOUR }]);
    if (!attempt.allowed) return sendTooManyAttempts(res, attempt.retryAfterSeconds);
    next();
  };
}

// --- Forgot password --------------------------------------------------------

accountRouter.post("/forgot-password", limitByAddress("forgot", 10), (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
  const user = email ? findUserByEmailWithPassword(email) : null;

  // Limit per email too, so nobody can flood a person's inbox. Going over the
  // limit quietly sends nothing: an error here would confirm the account exists.
  if (user && consumeAttempt([{ key: `forgot:email:${email}`, limit: 3, windowMs: HOUR }]).allowed) {
    sendPasswordResetEmail(user);
  }

  // Always the same answer, so this can't reveal who has an account.
  res.json({ message: "If an account exists for that email, we've sent a link to reset the password." });
});

// --- Reset password ---------------------------------------------------------

accountRouter.post("/reset-password", limitByAddress("reset", 20), async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  // Checked first, so a password that's too short doesn't use up the link.
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    });
  }

  // Taken before the slow hashing below, so two requests can't both use it.
  const userId = consumeAccountToken(req.body?.token, PASSWORD_RESET);
  if (!userId) return res.status(400).json({ error: INVALID_LINK });

  updateUserPassword(userId, await hashPassword(password));

  // If someone else had access to the account, this logs them out too.
  destroyAllSessionsForUser(userId);

  // Using a link sent to the inbox proves the email belongs to this person.
  markEmailConfirmed(userId);

  const user = findUserById(userId);
  resetAttempts(loginLimits(req.ip, user.email).account.key);

  res.json({ message: "Your password has been changed. You can log in now." });
});

// --- Confirm email ----------------------------------------------------------

accountRouter.post("/confirm-email", limitByAddress("confirm", 20), (req, res) => {
  const userId = consumeAccountToken(req.body?.token, EMAIL_CONFIRMATION);
  if (!userId) return res.status(400).json({ error: INVALID_LINK });

  markEmailConfirmed(userId);
  res.json({ message: "Your email is confirmed." });
});

accountRouter.post("/resend-confirmation", requireAuth, (req, res) => {
  if (req.user.emailConfirmed) return res.json({ message: "Your email is already confirmed." });

  const attempt = consumeAttempt([{ key: `resend:user:${req.user.id}`, limit: 5, windowMs: HOUR }]);
  if (!attempt.allowed) return sendTooManyAttempts(res, attempt.retryAfterSeconds);

  sendConfirmationEmail(req.user);
  res.json({ message: "We've sent you a new confirmation link." });
});
