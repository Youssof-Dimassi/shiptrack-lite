// A job queue: work that happens in the background, outside a web request.
//
// Jobs are rows in the database, so nothing is lost if the server restarts.
// A worker (worker.js) picks up jobs that are due and runs them. If a job
// fails, it's tried again later, waiting longer each time, up to a limit.
//
// Each kind of job has a handler, registered with defineJob (see definitions.js).

import { db } from "../db/database.js";

const MINUTE = 60 * 1000;
const MAX_RETRY_DELAY_MINUTES = 60;
const DEFAULT_MAX_ATTEMPTS = 5;

const handlers = new Map();

const insertJob = db.prepare(`
  INSERT INTO jobs (type, payload, max_attempts, run_at, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

// Picks the next due job and marks it as running in a single statement, so two
// workers can never pick the same job.
const claimNextJob = db.prepare(`
  UPDATE jobs
  SET status = 'running', attempts = attempts + 1, locked_at = :now
  WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending' AND run_at <= :now
    ORDER BY run_at, id
    LIMIT 1
  )
  RETURNING id, type, payload, attempts, max_attempts
`);

// Finished jobs keep no payload: an email job's payload can contain a private
// link, and it shouldn't stay in the database once it's no longer needed.
const markDone = db.prepare(`
  UPDATE jobs SET status = 'done', payload = '{}', locked_at = NULL, last_error = NULL, finished_at = ?
  WHERE id = ?
`);
const markFailed = db.prepare(`
  UPDATE jobs SET status = 'failed', payload = '{}', locked_at = NULL, last_error = ?, finished_at = ?
  WHERE id = ?
`);
const scheduleRetry = db.prepare(`
  UPDATE jobs SET status = 'pending', locked_at = NULL, run_at = ?, last_error = ?
  WHERE id = ?
`);
const releaseStuckJobs = db.prepare(`
  UPDATE jobs SET status = 'pending', locked_at = NULL
  WHERE status = 'running' AND locked_at <= ?
`);
const deleteFinishedBefore = db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at <= ?");

export function defineJob(type, handler) {
  handlers.set(type, handler);
}

export function enqueueJob(type, payload, { delayMs = 0, maxAttempts = DEFAULT_MAX_ATTEMPTS, now = Date.now() } = {}) {
  insertJob.run(type, JSON.stringify(payload), maxAttempts, now + delayMs, now);
}

// 1, 2, 4, 8... minutes after each failure, never more than an hour.
export function retryDelayMs(attempts) {
  return Math.min(2 ** (attempts - 1), MAX_RETRY_DELAY_MINUTES) * MINUTE;
}

// Runs every job that's due, one at a time, including jobs that those jobs
// add. Returns how many ran. "now" can be passed in by tests.
export async function processDueJobs({ now } = {}) {
  let processed = 0;
  for (;;) {
    const job = claimNextJob.get({ now: now ?? Date.now() });
    if (!job) return processed;
    processed += 1;
    await runJob(job, now ?? Date.now());
  }
}

async function runJob(job, now) {
  const handler = handlers.get(job.type);

  // Retrying can't fix an unknown job type, so it fails straight away.
  if (!handler) {
    markFailed.run(`Unknown job type "${job.type}"`, now, job.id);
    console.error(`Job ${job.id} failed: unknown job type "${job.type}".`);
    return;
  }

  try {
    await handler(JSON.parse(job.payload));
    markDone.run(now, job.id);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 500);
    if (job.attempts >= job.max_attempts) {
      markFailed.run(message, now, job.id);
    } else {
      scheduleRetry.run(now + retryDelayMs(job.attempts), message, job.id);
    }
    console.error(`Job ${job.id} (${job.type}) failed on attempt ${job.attempts} of ${job.max_attempts}: ${message}`);
  }
}

// A job left "running" by a server that crashed would otherwise never finish.
export function releaseJobsStuckSince(time) {
  return releaseStuckJobs.run(time).changes;
}

export function deleteFinishedJobsBefore(time) {
  return deleteFinishedBefore.run(time).changes;
}
