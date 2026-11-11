// Sends email using whichever method config.js picked.

import nodemailer from "nodemailer";
import { emailFrom, emailTransport } from "../config.js";

// Only used by the automated tests.
export const sentEmails = [];

const smtpTransport = emailTransport === "smtp" ? nodemailer.createTransport(process.env.SMTP_URL) : null;

export async function sendEmail({ to, subject, text, headers = {}, replyTo }) {
  if (emailTransport === "memory") {
    sentEmails.push({ to, subject, text, headers, replyTo });
    return;
  }

  if (emailTransport === "smtp") {
    await smtpTransport.sendMail({ from: emailFrom, to, subject, text, headers, replyTo });
    return;
  }

  // Never print email in production: these messages contain private links.
  if (emailTransport === "disabled") {
    console.warn("Email isn't set up on this server, so a message was not sent. Set SMTP_URL.");
    return;
  }

  console.log(`\n----- EMAIL (printed because this is development) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-------------------------------------------------------\n`);
}
