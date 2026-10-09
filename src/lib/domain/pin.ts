import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** PINs are 4–6 digits and are stored only as salted scrypt hashes. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin) && !/^(\d)\1+$/.test(pin) && !["1234", "12345", "123456", "0000"].includes(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
