// The emails sent for account actions.

import { appUrl } from "../config.js";
import { EMAIL_CHANGE, EMAIL_CONFIRMATION, PASSWORD_RESET, createAccountToken } from "../models/accountTokens.js";
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

// Sent to the NEW address: the change only happens when this link is opened.
export function sendEmailChangeConfirmation(user) {
  const token = createAccountToken(user.id, EMAIL_CHANGE);

  deliverInBackground({
    to: user.newEmail,
    subject: "Confirm your new ShipTrack Lite email",
    text: `Hi ${user.name},

You asked to change the email address of your ShipTrack Lite account to this one.
Open this link to confirm:

${appUrl}/confirm-email-change?token=${token}

The link works once and expires in 24 hours.
If you didn't ask for this, you can ignore this email.`,
  });
}

// Sent to the OLD address after a change, in case someone else made it.
export function sendEmailChangedNotice({ name, oldEmail, newEmail }) {
  deliverInBackground({
    to: oldEmail,
    subject: "Your ShipTrack Lite email was changed",
    text: `Hi ${name},

The email address of your ShipTrack Lite account was changed to ${newEmail}.

If you made this change, there's nothing else to do.
If you didn't, someone may have access to your account. Contact us right away: ${appUrl}/contact`,
  });
}

export function sendPasswordChangedNotice(user) {
  deliverInBackground({
    to: user.email,
    subject: "Your ShipTrack Lite password was changed",
    text: `Hi ${user.name},

The password of your ShipTrack Lite account was just changed, and your other devices were logged out.

If you made this change, there's nothing else to do.
If you didn't, reset your password right away: ${appUrl}/forgot-password`,
  });
}
