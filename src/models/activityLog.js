// The activity log: a permanent record of what staff did, and when.
//
// The staff member's name and email are copied into each entry, so the record
// still says who did it even if their account is deleted later.

import { db } from "../db/database.js";

const insertEntry = db.prepare(`
  INSERT INTO activity_log (occurred_at, actor_id, actor_name, actor_email, action, summary)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// :category is "shipment", "user", or NULL for everything.
const MATCHES_CATEGORY = "(:category IS NULL OR action LIKE :category || '.%')";

const countEntries = db.prepare(`SELECT COUNT(*) AS count FROM activity_log WHERE ${MATCHES_CATEGORY}`);

const selectEntries = db.prepare(`
  SELECT id, occurred_at, actor_id, actor_name, actor_email, action, summary
  FROM activity_log
  WHERE ${MATCHES_CATEGORY}
  ORDER BY id DESC
  LIMIT :limit OFFSET :offset
`);

const deleteBefore = db.prepare("DELETE FROM activity_log WHERE occurred_at < ?");

export const ACTIVITY_CATEGORIES = ["shipment", "user"];

// actor is the logged-in staff member (req.user). action is a short code like
// "shipment.created"; summary is the sentence people read.
export function logActivity(actor, action, summary) {
  insertEntry.run(new Date().toISOString(), actor.id, actor.name, actor.email, action, summary);
}

export function listActivity({ page = 1, pageSize = 50, category = null } = {}) {
  const total = countEntries.get({ category }).count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = selectEntries.all({ category, limit: pageSize, offset: (currentPage - 1) * pageSize });
  return { entries: rows.map(toEntry), page: currentPage, pageSize, total, totalPages };
}

// Old entries are removed after a year (see jobs/worker.js).
export function deleteActivityBefore(isoTime) {
  return deleteBefore.run(isoTime).changes;
}

function toEntry(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    actorDeleted: row.actor_id === null,
    action: row.action,
    summary: row.summary,
  };
}
