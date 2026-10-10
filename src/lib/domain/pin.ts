import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PIN_LENGTH = 4;
const WEAK = ["1234", "4321", "0123", "1212", "2580", "0852"];

/** PINs are exactly 4 digits (the sign-in keypad), not all the same digit and not an obvious sequence. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin) && !/^(\d)\1+$/.test(pin) && !WEAK.includes(pin);
}

export const PIN_RULE = "Use 4 digits. Not all the same digit and not an easy pattern like 1234.";

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
