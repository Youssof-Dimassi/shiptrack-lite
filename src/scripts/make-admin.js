// Gives an existing account admin rights.
//
//   npm run make-admin -- someone@example.com
//
// This is a terminal command on purpose: only someone with access to the
// server can run it, so no request from the website can ever create an admin.

import { setUserRole } from "../models/users.js";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: npm run make-admin -- someone@example.com");
  process.exit(1);
}

if (!setUserRole(email, "admin")) {
  console.error(`No account found for ${email}. Sign up on the website first.`);
  process.exit(1);
}

console.log(`${email} is now an admin. Refresh the website to see the Admin link.`);
