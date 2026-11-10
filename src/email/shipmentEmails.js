// The email customers get when a saved shipment is updated.

import { appUrl } from "../config.js";

export function shipmentUpdateEmail({ recipient, update, unsubscribeToken }) {
  const unsubscribePage = `${appUrl}/unsubscribe?token=${unsubscribeToken}`;

  return {
    to: recipient.email,
    subject: `${update.trackingNumber}: ${update.status}`,
    text: `Hi ${recipient.name},

There's an update on your shipment ${update.trackingNumber} (${update.origin} → ${update.destination}).

Status: ${update.status}
What happened: ${update.description}
Where: ${update.location}

See the full history:
${appUrl}/?track=${update.trackingNumber}

---
You're getting this because you saved this shipment to your ShipTrack Lite account.
To stop these emails: ${unsubscribePage}`,

    // Lets email apps show their own "Unsubscribe" button, which unsubscribes
    // in one click without opening our site (the RFC 8058 standard).
    headers: {
      "List-Unsubscribe": `<${appUrl}/api/notifications/unsubscribe?token=${unsubscribeToken}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
