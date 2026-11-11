// Numbers for the admin dashboard. Everything is counted from the database.

import { db } from "../db/database.js";
import { listActivity } from "./activityLog.js";
import { SHIPMENT_STATUSES } from "./shipments.js";

const WEEKS_SHOWN = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// Overdue: not finished, and the estimated delivery date has passed.
const NOT_FINISHED = "status NOT IN ('Delivered', 'Cancelled')";
const IS_OVERDUE = `${NOT_FINISHED} AND estimated_delivery < date('now')`;

const selectTotals = db.prepare(`
  SELECT (SELECT COUNT(*) FROM shipments) AS shipments,
         (SELECT COUNT(*) FROM shipments WHERE ${NOT_FINISHED}) AS active,
         (SELECT COUNT(*) FROM shipments WHERE status = 'Delivered') AS delivered,
         (SELECT COUNT(*) FROM shipments WHERE ${IS_OVERDUE}) AS overdue,
         (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
         (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins
`);

const selectByStatus = db.prepare("SELECT status, COUNT(*) AS count FROM shipments GROUP BY status");

// A shipment "starts" at its first history entry. Each start date is rounded
// down to the Monday of its week ('weekday 0' finds Sunday, then back 6 days).
const selectStartsPerWeek = db.prepare(`
  SELECT week, COUNT(*) AS count
  FROM (
    SELECT date(MIN(occurred_at), 'weekday 0', '-6 days') AS week
    FROM shipment_events
    GROUP BY shipment_id
  )
  WHERE week >= ?
  GROUP BY week
`);

// From the first history entry to the last, for delivered shipments.
const selectAverageDeliveryDays = db.prepare(`
  SELECT AVG(julianday(last_entry) - julianday(first_entry)) AS days
  FROM (
    SELECT MIN(e.occurred_at) AS first_entry, MAX(e.occurred_at) AS last_entry
    FROM shipments s
    JOIN shipment_events e ON e.shipment_id = s.id
    WHERE s.status = 'Delivered'
    GROUP BY s.id
  )
`);

const selectOverdue = db.prepare(`
  SELECT tracking_number, status, destination, estimated_delivery
  FROM shipments
  WHERE ${IS_OVERDUE}
  ORDER BY estimated_delivery, id
  LIMIT 5
`);

export function getDashboardData(today = new Date()) {
  const totals = { ...selectTotals.get() };

  const counts = Object.fromEntries(selectByStatus.all().map((row) => [row.status, row.count]));
  const byStatus = SHIPMENT_STATUSES.map((status) => ({ status, count: counts[status] ?? 0 }));

  const weeks = lastWeekStarts(today, WEEKS_SHOWN);
  const started = Object.fromEntries(selectStartsPerWeek.all(weeks[0]).map((row) => [row.week, row.count]));
  const startedPerWeek = weeks.map((weekStart) => ({ weekStart, count: started[weekStart] ?? 0 }));

  const { days } = selectAverageDeliveryDays.get();

  return {
    totals,
    byStatus,
    startedPerWeek,
    averageDeliveryDays: days === null ? null : Math.round(days * 10) / 10,
    overdueShipments: selectOverdue.all().map((row) => ({
      trackingNumber: row.tracking_number,
      status: row.status,
      destination: row.destination,
      estimatedDelivery: row.estimated_delivery,
    })),
    recentActivity: listActivity({ pageSize: 5 }).entries,
  };
}

// The Mondays (as YYYY-MM-DD, in UTC) of this week and the weeks before it, oldest first.
export function lastWeekStarts(today, count) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const thisMonday = date.getTime() - daysSinceMonday * DAY_MS;
  return Array.from({ length: count }, (_, index) =>
    new Date(thisMonday - (count - 1 - index) * 7 * DAY_MS).toISOString().slice(0, 10),
  );
}
