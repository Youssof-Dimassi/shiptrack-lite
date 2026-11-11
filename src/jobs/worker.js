// Checks the job queue every few seconds and runs whatever is due.

import { deleteActivityBefore } from "../models/activityLog.js";
import { deleteFinishedJobsBefore, processDueJobs, releaseJobsStuckSince } from "./queue.js";

const MINUTE = 60 * 1000;
const STUCK_AFTER_MS = 10 * MINUTE;
const KEEP_FINISHED_MS = 7 * 24 * 60 * MINUTE;
const KEEP_ACTIVITY_MS = 365 * 24 * 60 * MINUTE;
const HOUSEKEEPING_EVERY_MS = 60 * MINUTE;

// Returns a function that stops the worker.
export function startWorker({ intervalMs = 2000 } = {}) {
  let busy = false;
  let lastHousekeeping = 0;

  async function tick() {
    if (busy) return; // the previous round is still running
    busy = true;
    try {
      const now = Date.now();
      if (now - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
        lastHousekeeping = now;
        releaseJobsStuckSince(now - STUCK_AFTER_MS);
        deleteFinishedJobsBefore(now - KEEP_FINISHED_MS);
        deleteActivityBefore(new Date(now - KEEP_ACTIVITY_MS).toISOString());
      }
      await processDueJobs();
    } catch (error) {
      console.error(`The job worker had a problem: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}
