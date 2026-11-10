// Email notification settings.
//
//   PUT  /api/notifications/preferences { shipmentUpdates: true|false } → turn update emails on or off
//   POST /api/notifications/unsubscribe?token=...                       → turn them off from an email link

import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { sendTooManyAttempts } from "../auth/rateLimiting.js";
import { consumeAttempt } from "../models/rateLimits.js";
import { setShipmentUpdateEmails, unsubscribeWithToken } from "../models/users.js";

export const notificationsRouter = Router();

notificationsRouter.put("/preferences", requireAuth, (req, res) => {
  const enabled = req.body?.shipmentUpdates;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "shipmentUpdates must be true or false." });
  }

  setShipmentUpdateEmails(req.user.id, enabled);
  res.json({ shipmentUpdates: enabled });
});

// Email apps' one-click unsubscribe puts the token in the address (and sends a
// form body we don't need). The unsubscribe page sends it as JSON instead.
notificationsRouter.post("/unsubscribe", (req, res) => {
  const attempt = consumeAttempt([{ key: `unsubscribe:ip:${req.ip}`, limit: 30, windowMs: 60 * 60 * 1000 }]);
  if (!attempt.allowed) return sendTooManyAttempts(res, attempt.retryAfterSeconds);

  const token = typeof req.query.token === "string" ? req.query.token : req.body?.token;
  if (!unsubscribeWithToken(token)) return res.status(400).json({ error: "This link is invalid." });

  res.json({ message: "You won't get shipment update emails anymore." });
});
