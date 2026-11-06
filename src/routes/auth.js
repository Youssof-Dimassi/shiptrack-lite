// Account routes: register, log in, log out, and "who am I?".
//
//   POST /api/auth/register   { name, email, password }  → creates account + logs in
//   POST /api/auth/login      { email, password }        → logs in
//   POST /api/auth/logout                                → logs out
//   GET  /api/auth/me                                    → the logged-in user, or 401

import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { SESSION_COOKIE, readCookie, requireAuth } from "../auth/middleware.js";
import { SESSION_DURATION_MS, createSession, destroySession } from "../models/sessions.js";
import { createUser, findUserByEmailWithPassword } from "../models/users.js";

export const authRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// A real hash of a random password. Used when the email doesn't exist so that
// "wrong email" takes as long as "wrong password" (see the login route).
const DUMMY_HASH = await hashPassword("not-a-real-password-" + Math.random());

// --- Register ---------------------------------------------------------------

authRouter.post("/register", async (req, res) => {
  const name = cleanText(req.body?.name);
  const email = cleanText(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  // Validate everything on the server, even if the browser already checked.
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Please enter your name (up to 100 characters)." });
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    });
  }
  if (findUserByEmailWithPassword(email)) {
    // 409 Conflict: the request is valid, but clashes with existing data.
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await hashPassword(password);
  const userId = createUser({ name, email, passwordHash });

  startSession(res, userId);
  res.status(201).json({ user: { id: userId, name, email, role: "customer" } }); // 201 = Created
});

// --- Log in -----------------------------------------------------------------

authRouter.post("/login", async (req, res) => {
  const email = cleanText(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const user = findUserByEmailWithPassword(email);

  // Always run the slow password check, even if the email doesn't exist.
  // Otherwise "unknown email" would answer faster than "wrong password",
  // and attackers could use the timing to discover which emails have accounts.
  const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordOk) {
    // Same message for both cases, for the same reason.
    return res.status(401).json({ error: "Invalid email or password." });
  }

  startSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// --- Log out ----------------------------------------------------------------

authRouter.post("/logout", (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) destroySession(token);

  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.status(204).end(); // 204 = success, nothing to send back
});

// --- Who am I? --------------------------------------------------------------

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- Helpers ----------------------------------------------------------------

function startSession(res, userId) {
  const token = createSession(userId);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DURATION_MS });
}

function cookieOptions() {
  return {
    httpOnly: true, // JavaScript in the page can't read it, so XSS can't steal it
    sameSite: "lax", // not sent with requests that other websites trigger in the background
    secure: process.env.NODE_ENV === "production", // HTTPS-only once the site is online
    path: "/",
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
