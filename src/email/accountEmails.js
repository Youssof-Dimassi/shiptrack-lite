// The emails sent for account actions.

import { appUrl } from "../config.js";
import { EMAIL_CONFIRMATION, PASSWORD_RESET, createAccountToken } from "../models/accountTokens.js";
import { enqueueJob } from "../jobs/queue.js";

// Emails go through the job queue: the website doesn't wait for the mail
// server, a failed delivery is tried again later, and a reply can't take
// longer when an account exists (which would reveal who has an account).
function deliverInBackground(message) {
  enqueueJob("send-email", message);
}

export function sendConfirmationEmail(user) {
  const token = createAccountToken(user.id, EMAIL_CONFIRMATION);

  deliverInBackground({
    to: user.email,
    subject: "Confirm your ShipTrack Lite email",
    text: `Hi ${user.name},

Please confirm your email address by opening this link:

${appUrl}/confirm-email?token=${token}

The link works once and expires in 24 hours.
If you didn't create this account, you can ignore this email.`,
  });
}

export function sendPasswordResetEmail(user) {
  const token = createAccountToken(user.id, PASSWORD_RESET);

  deliverInBackground({
    to: user.email,
    subject: "Reset your ShipTrack Lite password",
    text: `Hi ${user.name},

Open this link to choose a new password:

${appUrl}/reset-password?token=${token}

The link works once and expires in 1 hour.
If you didn't ask for this, you can ignore this email. Your password won't change.`,
  });
}
