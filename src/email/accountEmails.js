// The emails sent for account actions.

import { appUrl } from "../config.js";
import { EMAIL_CONFIRMATION, PASSWORD_RESET, createAccountToken } from "../models/accountTokens.js";
import { sendEmail } from "./mailer.js";

// Doesn't wait for delivery, for two reasons: a slow mail server shouldn't slow
// the website down, and a reply that takes longer when the account exists
// would reveal who has an account. A failure is logged, without the contents.
function deliverInBackground(message) {
  sendEmail(message).catch((error) => {
    console.error(`Could not send an email: ${error.message}`);
  });
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
