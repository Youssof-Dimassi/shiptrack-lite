// The kinds of background job the app runs.

import { runInTransaction } from "../db/database.js";
import { sendEmail } from "../email/mailer.js";
import { shipmentUpdateEmail } from "../email/shipmentEmails.js";
import { listUpdateRecipients } from "../models/savedShipments.js";
import { findEventForEmail } from "../models/shipments.js";
import { getUnsubscribeToken } from "../models/users.js";
import { defineJob, enqueueJob } from "./queue.js";

defineJob("send-email", (message) => sendEmail(message));

// Staff posted an update: email every customer who wants to hear about it.
// Each email is its own job, so one bad address can't stop the others, and
// each one is retried on its own.
defineJob("notify-shipment-update", ({ shipmentId, eventId, status }) => {
  const update = findEventForEmail(shipmentId, eventId);
  if (!update) return; // the shipment or entry was deleted in the meantime

  runInTransaction(() => {
    for (const recipient of listUpdateRecipients(shipmentId)) {
      enqueueJob(
        "send-email",
        shipmentUpdateEmail({ recipient, update: { ...update, status }, unsubscribeToken: getUnsubscribeToken(recipient.id) }),
      );
    }
  });
});
