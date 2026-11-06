// Sample shipment data.
//
// This is temporary: in Step 4 it will be replaced by a real database.
// Each shipment has a list of "events": the history of where it has been,
// oldest first.

export const shipments = [
  {
    trackingNumber: "ST10000001",
    status: "In Transit",
    origin: "Beirut, Lebanon",
    destination: "Paris, France",
    estimatedDelivery: "2026-11-12",
    events: [
      { date: "2026-11-03T09:15:00Z", location: "Beirut, Lebanon", description: "Shipment created" },
      { date: "2026-11-04T14:30:00Z", location: "Beirut, Lebanon", description: "Picked up by courier" },
      { date: "2026-11-05T22:10:00Z", location: "Istanbul, Turkey", description: "Arrived at sorting hub" },
    ],
  },
  {
    trackingNumber: "ST10000002",
    status: "Delivered",
    origin: "Dubai, UAE",
    destination: "Beirut, Lebanon",
    estimatedDelivery: "2026-11-02",
    events: [
      { date: "2026-10-28T08:00:00Z", location: "Dubai, UAE", description: "Shipment created" },
      { date: "2026-10-29T11:45:00Z", location: "Dubai, UAE", description: "Picked up by courier" },
      { date: "2026-10-31T06:20:00Z", location: "Beirut, Lebanon", description: "Arrived at local facility" },
      { date: "2026-11-01T15:05:00Z", location: "Beirut, Lebanon", description: "Delivered" },
    ],
  },
  {
    trackingNumber: "ST10000003",
    status: "Pending",
    origin: "Berlin, Germany",
    destination: "Cairo, Egypt",
    estimatedDelivery: "2026-11-20",
    events: [
      { date: "2026-11-06T10:00:00Z", location: "Berlin, Germany", description: "Shipment created" },
    ],
  },
];
