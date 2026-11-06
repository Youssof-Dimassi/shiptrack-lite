// Authentication middleware.
//
// "Middleware" is a function that runs BEFORE the route handlers.
// loadUser runs on every request: it reads the session cookie and, if it's
// valid, puts the logged-in user on req.user. Routes can then simply check
// req.user to know who is making the request.

import { findUserIdBySessionToken } from "../models/sessions.js";
import { findUserById } from "../models/users.js";

export const SESSION_COOKIE = "sid";

export function loadUser(req, res, next) {
  req.user = null;

  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const userId = findUserIdBySessionToken(token);
    if (userId) req.user = findUserById(userId);
  }

  next(); // continue to the next middleware or route
}

// Put this in front of any route that needs a logged-in user.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to log in first." });
  }
  next();
}

// Browsers send cookies in one header: "sid=abc123; theme=dark"
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // badly encoded cookie: ignore it
    }
  }
  return null;
}
