// The location report: how many shipments are connected to a place, and how.
//
// Places are typed in by staff ("Beirut, Lebanon"), so searching matches part
// of the name and ignores capital letters: "beirut" finds "Beirut, Lebanon".

import { db } from "../db/database.js";
import { SHIPMENT_STATUSES, toShipment } from "./shipments.js";

const LIST_LIMIT = 50;

// Each shipment's most recent history entry: where it was last seen.
const LATEST_ENTRY = `
  latest AS (
    SELECT e.shipment_id, e.location
    FROM shipment_events e
    WHERE e.id = (
      SELECT e2.id FROM shipment_events e2
      WHERE e2.shipment_id = e.shipment_id
      ORDER BY e2.occurred_at DESC, e2.id DESC
      LIMIT 1
    )
  )
`;

// ESCAPE '\' lets the search contain % and _ as normal characters.
const MATCHES = (column) => `${column} LIKE :pattern ESCAPE '\\'`;

const HAS_ENTRY_HERE = `EXISTS (
  SELECT 1 FROM shipment_events e
  WHERE e.shipment_id = s.id AND ${MATCHES("e.location")}
)`;

const IS_CONNECTED = `(${MATCHES("s.origin")} OR ${MATCHES("s.destination")} OR ${HAS_ENTRY_HERE})`;

const selectCounts = db.prepare(`
  WITH ${LATEST_ENTRY}
  SELECT
    (SELECT COUNT(*) FROM shipments s WHERE ${MATCHES("s.origin")}) AS sent_from,
    (SELECT COUNT(*) FROM shipments s WHERE ${MATCHES("s.destination")}) AS going_to,
    (SELECT COUNT(*) FROM latest WHERE ${MATCHES("latest.location")}) AS last_seen,
    (SELECT COUNT(*) FROM shipments s WHERE ${HAS_ENTRY_HERE}) AS passed_through,
    (SELECT COUNT(*) FROM shipments s WHERE ${IS_CONNECTED}) AS connected
`);

const selectStatusCounts = db.prepare(`
  SELECT s.status, COUNT(*) AS count
  FROM shipments s
  WHERE ${IS_CONNECTED}
  GROUP BY s.status
`);

const selectShipments = db.prepare(`
  WITH ${LATEST_ENTRY}
  SELECT s.tracking_number, s.status, s.origin, s.destination, s.estimated_delivery,
         latest.location AS last_location,
         ${MATCHES("s.origin")} AS is_from,
         ${MATCHES("s.destination")} AS is_to,
         ${MATCHES("latest.location")} AS is_last_seen,
         ${HAS_ENTRY_HERE} AS has_entry
  FROM shipments s
  LEFT JOIN latest ON latest.shipment_id = s.id
  WHERE ${IS_CONNECTED}
  ORDER BY s.id DESC
  LIMIT ${LIST_LIMIT}
`);

// The places mentioned most, counting each shipment once per place, however
// the place is capitalized ("Beirut" and "BEIRUT" are the same place).
const selectBusiestPlaces = db.prepare(`
  SELECT MIN(place) AS place, COUNT(DISTINCT id) AS shipments
  FROM (
    SELECT shipment_id AS id, location AS place FROM shipment_events
    UNION ALL SELECT id, origin FROM shipments
    UNION ALL SELECT id, destination FROM shipments
  )
  GROUP BY lower(place)
  ORDER BY shipments DESC, place
  LIMIT 10
`);

export function getLocationReport(search) {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const counts = selectCounts.get({ pattern });

  const statusCounts = Object.fromEntries(selectStatusCounts.all({ pattern }).map((row) => [row.status, row.count]));

  return {
    search,
    counts: {
      sentFrom: counts.sent_from,
      goingTo: counts.going_to,
      lastSeen: counts.last_seen,
      passedThrough: counts.passed_through,
      connected: counts.connected,
    },
    byStatus: SHIPMENT_STATUSES.map((status) => ({ status, count: statusCounts[status] ?? 0 })),
    shipments: selectShipments.all({ pattern }).map((row) => ({
      ...toShipment(row),
      lastLocation: row.last_location,
      matches: {
        sentFrom: Boolean(row.is_from),
        goingTo: Boolean(row.is_to),
        lastSeen: Boolean(row.is_last_seen),
        passedThrough: Boolean(row.has_entry),
      },
    })),
    listLimit: LIST_LIMIT,
  };
}

export function getBusiestPlaces() {
  return selectBusiestPlaces.all().map((row) => ({ place: row.place, shipments: row.shipments }));
}
