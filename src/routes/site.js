// Public information about the site, and the contact form.
//
//   GET  /api/stats    → real counts shown on the home page
//   POST /api/contact  { name, email, message } → emails the message to the team

import { Router } from "express";
import { sendTooManyAttempts } from "../auth/rateLimiting.js";
import { contactEmail } from "../config.js";
import { enqueueJob } from "../jobs/queue.js";
import { consumeAttempt } from "../models/rateLimits.js";
import { getPublicStats } from "../models/shipments.js";
import { EMAIL_PATTERN } from "./auth.js";

export const siteRouter = Router();

const THANK_YOU = "Thanks for your message. We'll reply by email as soon as we can.";

// Only totals, never anything about a particular shipment or person.
siteRouter.get("/stats", (req, res) => {
  res.json(getPublicStats());
});

siteRouter.post("/contact", (req, res) => {
  const attempt = consumeAttempt([{ key: `contact:ip:${req.ip}`, limit: 5, windowMs: 60 * 60 * 1000 }]);
  if (!attempt.allowed) return sendTooManyAttempts(res, attempt.retryAfterSeconds);

  const name = cleanText(req.body?.name);
  const email = cleanText(req.body?.email).toLowerCase();
  const message = cleanText(req.body?.message);

  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Please enter your name (up to 100 characters)." });
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Please enter a valid email address, so we can reply." });
  }
  if (message.length < 10 || message.length > 2000) {
    return res.status(400).json({ error: "Please write a message between 10 and 2,000 characters." });
  }

  // The hidden "website" field is a trap: people never see it, but spam robots
  // fill in every field. They get the same thank-you, so they don't learn they
  // were caught, but nothing is sent.
  if (req.body?.website) return res.json({ message: THANK_YOU });

  enqueueJob("send-email", {
    to: contactEmail,
    replyTo: email, // pressing Reply answers the customer directly
    subject: "New message from the ShipTrack Lite contact form",
    text: `From: ${name} <${email}>\n\n${message}`,
  });

  res.json({ message: THANK_YOU });
});

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
