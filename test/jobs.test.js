import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import "./helpers.js";

const { db, runInTransaction } = await import("../src/db/database.js");
const {
  defineJob,
  deleteFinishedJobsBefore,
  enqueueJob,
  processDueJobs,
  releaseJobsStuckSince,
  retryDelayMs,
} = await import("../src/jobs/queue.js");

const MINUTE = 60 * 1000;
const START = 1_000_000_000;
let typeNumber = 0;

beforeEach(() => db.exec("DELETE FROM jobs"));

// A fresh job type for each test, with a handler that records its calls.
function newJobType(behavior = () => {}) {
  typeNumber += 1;
  const type = `test-job-${typeNumber}`;
  const calls = [];
  defineJob(type, async (payload) => {
    calls.push(payload);
    await behavior(payload, calls.length);
  });
  return { type, calls };
}

function jobRows() {
  return db.prepare("SELECT type, payload, status, attempts, run_at, last_error FROM jobs ORDER BY id").all();
}

describe("running jobs", () => {
  it("runs a job with its payload, then marks it done", async () => {
    const { type, calls } = newJobType();
    enqueueJob(type, { hello: "world" }, { now: START });

    assert.equal(await processDueJobs({ now: START }), 1);
    assert.deepEqual(calls, [{ hello: "world" }]);
    assert.equal(jobRows()[0].status, "done");
  });

  it("runs each job only once", async () => {
    const { type, calls } = newJobType();
    enqueueJob(type, {}, { now: START });
    await processDueJobs({ now: START });
    await processDueJobs({ now: START + MINUTE });
    assert.equal(calls.length, 1);
  });

  it("runs due jobs in order", async () => {
    const order = [];
    const { type } = newJobType((payload) => order.push(payload.n));
    enqueueJob(type, { n: 2 }, { now: START, delayMs: 2000 });
    enqueueJob(type, { n: 1 }, { now: START, delayMs: 1000 });
    enqueueJob(type, { n: 3 }, { now: START, delayMs: 2000 });
    await processDueJobs({ now: START + 5000 });
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("waits until a delayed job is due", async () => {
    const { type, calls } = newJobType();
    enqueueJob(type, {}, { now: START, delayMs: MINUTE });
    assert.equal(await processDueJobs({ now: START + MINUTE - 1 }), 0);
    assert.equal(await processDueJobs({ now: START + MINUTE }), 1);
    assert.equal(calls.length, 1);
  });

  it("also runs jobs that a job adds", async () => {
    const child = newJobType();
    const parent = newJobType(() => enqueueJob(child.type, { from: "parent" }));
    enqueueJob(parent.type, {});
    assert.equal(await processDueJobs(), 2);
    assert.deepEqual(child.calls, [{ from: "parent" }]);
  });

  it("never runs the same job twice when two workers run at once", async () => {
    const { type, calls } = newJobType(() => new Promise((resolve) => setTimeout(resolve, 5)));
    for (let i = 0; i < 10; i += 1) enqueueJob(type, { i });
    await Promise.all([processDueJobs(), processDueJobs(), processDueJobs()]);
    assert.equal(calls.length, 10);
    assert.equal(new Set(calls.map((payload) => payload.i)).size, 10);
  });
});

describe("when a job fails", () => {
  it("tries again later, waiting longer each time", async () => {
    const { type, calls } = newJobType(() => {
      throw new Error("mail server down");
    });
    enqueueJob(type, {}, { now: START });

    await processDueJobs({ now: START });
    let [row] = jobRows();
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 1);
    assert.equal(row.run_at, START + MINUTE);
    assert.equal(row.last_error, "mail server down");

    assert.equal(await processDueJobs({ now: START + MINUTE - 1 }), 0);
    await processDueJobs({ now: START + MINUTE });
    [row] = jobRows();
    assert.equal(row.attempts, 2);
    assert.equal(row.run_at, START + MINUTE + 2 * MINUTE);
    assert.equal(calls.length, 2);
  });

  it("succeeds on a later try", async () => {
    const { type } = newJobType((payload, callNumber) => {
      if (callNumber === 1) throw new Error("temporary");
    });
    enqueueJob(type, {}, { now: START });
    await processDueJobs({ now: START });
    await processDueJobs({ now: START + MINUTE });
    assert.equal(jobRows()[0].status, "done");
  });

  it("gives up after the last attempt", async () => {
    const { type, calls } = newJobType(() => {
      throw new Error("always broken");
    });
    enqueueJob(type, { secret: "link" }, { now: START, maxAttempts: 3 });

    for (let hour = 0; hour < 10; hour += 1) await processDueJobs({ now: START + hour * 60 * MINUTE });

    const [row] = jobRows();
    assert.equal(calls.length, 3);
    assert.equal(row.status, "failed");
    assert.equal(row.last_error, "always broken");
    assert.equal(row.payload, "{}");
  });

  it("fails an unknown job type straight away", async () => {
    enqueueJob("no-such-job", {}, { now: START });
    await processDueJobs({ now: START });
    const [row] = jobRows();
    assert.equal(row.status, "failed");
    assert.match(row.last_error, /Unknown job type/);
  });

  it("waits 1, 2, 4... minutes, up to an hour", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => retryDelayMs(n) / MINUTE), [1, 2, 4, 8, 16, 32, 60, 60]);
  });
});

describe("keeping the queue healthy", () => {
  it("removes the payload from finished jobs", async () => {
    const { type } = newJobType();
    enqueueJob(type, { secret: "private-link" }, { now: START });
    await processDueJobs({ now: START });
    assert.equal(jobRows()[0].payload, "{}");
  });

  it("restarts jobs left running by a crashed server", async () => {
    const { type, calls } = newJobType();
    enqueueJob(type, {}, { now: START });
    db.prepare("UPDATE jobs SET status = 'running', locked_at = ?").run(START);

    assert.equal(releaseJobsStuckSince(START - 1), 0);
    assert.equal(releaseJobsStuckSince(START), 1);
    await processDueJobs({ now: START });
    assert.equal(calls.length, 1);
  });

  it("deletes old finished jobs but keeps pending ones", async () => {
    const { type } = newJobType();
    enqueueJob(type, {}, { now: START });
    await processDueJobs({ now: START });
    enqueueJob(type, {}, { now: START, delayMs: 60 * MINUTE });

    assert.equal(deleteFinishedJobsBefore(START - 1), 0);
    assert.equal(deleteFinishedJobsBefore(START), 1);
    assert.deepEqual(jobRows().map((row) => row.status), ["pending"]);
  });

  it("adds no job when the surrounding change fails", () => {
    const { type } = newJobType();
    assert.throws(() =>
      runInTransaction(() => {
        enqueueJob(type, {});
        throw new Error("the change failed");
      }),
    );
    assert.equal(jobRows().length, 0);
  });

  it("supports a transaction inside another one", () => {
    const { type } = newJobType();
    runInTransaction(() => {
      enqueueJob(type, {});
      runInTransaction(() => enqueueJob(type, {}));
    });
    assert.equal(jobRows().length, 2);
  });
});
