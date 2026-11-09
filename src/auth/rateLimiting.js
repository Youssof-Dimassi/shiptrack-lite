// Shared rate limiting responses and rules.

import { consumeAttempt } from "../models/rateLimits.js";

// 429 means "too many requests". Retry-After tells the caller how long to wait.
export function sendTooManyAttempts(res, retryAfterSeconds) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  res.set("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  });
}

// A tracking number is what lets someone see a shipment, so nobody should be
// able to try millions of them. 60 a minute is far more than a real person needs.
export function limitTrackingLookups(req, res, next) {
  const attempt = consumeAttempt([{ key: `tracking:ip:${req.ip}`, limit: 60, windowMs: 60 * 1000 }]);
  if (!attempt.allowed) return sendTooManyAttempts(res, attempt.retryAfterSeconds);
  next();
}
