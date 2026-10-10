import type { SiteId } from "./types";

/**
 * Site devices. A tablet is registered to one site with a one-time pairing code that an owner creates.
 * Registered devices show that site's staff on the sign-in screen; anything else shows no names and
 * only allows owners to sign in with staff ID + PIN.
 */

export interface Device { id: string; siteId: SiteId; label: string; status: "active" | "locked"; lastSeen?: number; createdAt: number }

/** No 0/O, 1/I/L: easy to read aloud and type on a tablet. */
export const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LENGTH = 6;
export const PAIR_TTL_MINUTES = 15;

/** Turns whatever was typed ("abc-234", " ABC 234 ") into the stored form, or null if it can't be a code. */
export function normalizePairCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== PAIR_CODE_LENGTH) return null;
  for (const ch of code) if (!PAIR_ALPHABET.includes(ch)) return null;
  return code;
}

/** Builds a code from random numbers in [0, 1) (crypto-random in production). */
export function makePairCode(random: () => number): string {
  let out = "";
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) out += PAIR_ALPHABET[Math.floor(random() * PAIR_ALPHABET.length)];
  return out;
}

/** Shown as ABC-234 so it's easier to read out. */
export const formatPairCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

export type DeviceCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether a name-and-PIN sign-in may happen on this device for this site.
 * Owners signing in on an unregistered device use the separate staff ID route instead.
 */
export function canUseDeviceForSite(device: Device | null, siteId: SiteId): DeviceCheck {
  if (!device) return { allowed: false, reason: "This device isn't set up for staff sign-in. Ask an owner" };
  if (device.status !== "active") return { allowed: false, reason: "This device has been removed. Ask an owner" };
  if (device.siteId !== siteId) return { allowed: false, reason: "This device belongs to another site" };
  return { allowed: true };
}

/**
 * A session stays valid only while its device does. Sessions without a device are owner sign-ins
 * from an unregistered device and are valid for owners only.
 */
export function sessionDeviceOk(deviceId: string | undefined, device: Device | undefined, isOwner: boolean): boolean {
  if (!deviceId) return isOwner;
  return !!device && device.status === "active";
}
