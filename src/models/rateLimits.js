// Rate limiting: counts attempts so nobody can try things endlessly.
//
// Each limit is a "bucket" with a counter and a time when it resets.
// Buckets live in the database, so a server restart doesn't wipe them.
// Bucket names are hashed, so no email or internet address is stored here.
//
// A rule looks like: { key: "login:ip:1.2.3.4", limit: 30, windowMs: 900000 }

import { createHash } from "node:crypto";
import { db } from "../db/database.js";

const PURGE_INTERVAL_MS = 10 * 60 * 1000;
let lastPurgeAt = 0;

const selectActive = db.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ? AND reset_at > ?");

// Adds one hit. If the bucket's time is up, it starts again from 1.
const recordHit = db.prepare(`
  INSERT INTO rate_limits (bucket, hits, reset_at)
  VALUES (:bucket, 1, :resetAt)
  ON CONFLICT (bucket) DO UPDATE SET
    hits     = CASE WHEN reset_at <= :now THEN 1 ELSE hits + 1 END,
    reset_at = CASE WHEN reset_at <= :now THEN excluded.reset_at ELSE reset_at END
`);

const deleteBucket = db.prepare("DELETE FROM rate_limits WHERE bucket = ?");
const removeOneHit = db.prepare("UPDATE rate_limits SET hits = hits - 1 WHERE bucket = ? AND hits > 0");
const deleteExpired = db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?");
const deleteAll = db.prepare("DELETE FROM rate_limits");

function bucketFor(key) {
  return createHash("sha256").update(key).digest("hex");
}

// Checks every rule, and records one attempt against each if all of them allow it.
// Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
//
// This must run BEFORE any slow work. There is no "await" in here, so two
// requests can't both read the same count: without that, an attacker could
// send 100 guesses at once and they would all get past the limit.
export function consumeAttempt(rules, now = Date.now()) {
  purgeExpired(now);

  const blockedUntil = [];
  for (const rule of rules) {
    const active = selectActive.get(bucketFor(rule.key), now);
    if (active && active.hits >= rule.limit) blockedUntil.push(active.reset_at);
  }

  // A blocked attempt isn't counted, so it can't push the unblock time back.
  if (blockedUntil.length > 0) {
    return { allowed: false, retryAfterSeconds: Math.ceil((Math.max(...blockedUntil) - now) / 1000) };
  }

  for (const rule of rules) {
    recordHit.run({ bucket: bucketFor(rule.key), resetAt: now + rule.windowMs, now });
  }
  return { allowed: true };
}

// Starts a bucket over, e.g. after a successful log-in.
export function resetAttempts(key) {
  deleteBucket.run(bucketFor(key));
}

// Takes back one attempt, without touching any others counted in the bucket.
export function refundAttempt(key) {
  removeOneHit.run(bucketFor(key));
}

export function clearAllRateLimits() {
  deleteAll.run();
}

// Old buckets are useless, so they're deleted now and then.
function purgeExpired(now) {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  deleteExpired.run(now);
}
