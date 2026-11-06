// Password hashing.
//
// A hash is a one-way scramble: easy to compute from the password,
// practically impossible to reverse. To check a login, we hash the typed
// password again and compare the two hashes.
//
// We use "scrypt", which is built into Node.js and is deliberately SLOW
// and memory-hungry. That's fine for one login, but makes it extremely
// expensive for an attacker to guess billions of passwords.
//
// A random "salt" is added to every password before hashing, so two users
// with the same password still get completely different hashes.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// "secret123" → "scrypt$<salt>$<hash>"
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

// true if the password matches the stored hash, otherwise false.
export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hashHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, salt, expected.length);

  // timingSafeEqual takes the same time whether the first byte or the last
  // byte differs, so attackers can't learn anything by timing the answer.
  return timingSafeEqual(actual, expected);
}
