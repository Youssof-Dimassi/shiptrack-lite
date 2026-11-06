// Sample data ("seed" data) so the app has something to show on a fresh
// install. It is only inserted if the shipments table is empty.

const sampleShipments = [
  {
    trackingNumber: "ST10000001",
    status: "In Transit",
    origin: "Beirut, Lebanon",
    destination: "Paris, France",
    estimatedDelivery: "2026-11-12",
    events: [
      { occurredAt: "2026-11-03T09:15:00Z", location: "Beirut, Lebanon", description: "Shipment created" },
      { occurredAt: "2026-11-04T14:30:00Z", location: "Beirut, Lebanon", description: "Picked up by courier" },
      { occurredAt: "2026-11-05T22:10:00Z", location: "Istanbul, Turkey", description: "Arrived at sorting hub" },
    ],
  },
  {
    trackingNumber: "ST10000002",
    status: "Delivered",
    origin: "Dubai, UAE",
    destination: "Beirut, Lebanon",
    estimatedDelivery: "2026-11-02",
    events: [
      { occurredAt: "2026-10-28T08:00:00Z", location: "Dubai, UAE", description: "Shipment created" },
      { occurredAt: "2026-10-29T11:45:00Z", location: "Dubai, UAE", description: "Picked up by courier" },
      { occurredAt: "2026-10-31T06:20:00Z", location: "Beirut, Lebanon", description: "Arrived at local facility" },
      { occurredAt: "2026-11-01T15:05:00Z", location: "Beirut, Lebanon", description: "Delivered" },
    ],
  },
  {
    trackingNumber: "ST10000003",
    status: "Pending",
    origin: "Berlin, Germany",
    destination: "Cairo, Egypt",
    estimatedDelivery: "2026-11-20",
    events: [
      { occurredAt: "2026-11-06T10:00:00Z", location: "Berlin, Germany", description: "Shipment created" },
    ],
  },
];

export function seedDatabase(db) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM shipments").get();
  if (count > 0) return; // already has data: do nothing

  // The "?" marks are placeholders. The real values are passed separately
  // in .run(...), so they can never be mistaken for SQL code.
  const insertShipment = db.prepare(`
    INSERT INTO shipments (tracking_number, status, origin, destination, estimated_delivery)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO shipment_events (shipment_id, occurred_at, location, description)
    VALUES (?, ?, ?, ?)
  `);

  // A transaction groups many changes into one: either ALL of them are
  // saved, or (if anything fails) NONE of them are.
  db.exec("BEGIN");
  try {
    for (const s of sampleShipments) {
      const { lastInsertRowid: shipmentId } = insertShipment.run(
        s.trackingNumber, s.status, s.origin, s.destination, s.estimatedDelivery,
      );
      for (const e of s.events) {
        insertEvent.run(shipmentId, e.occurredAt, e.location, e.description);
      }
    }
    db.exec("COMMIT");
    console.log(`Database seeded with ${sampleShipments.length} sample shipments.`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
