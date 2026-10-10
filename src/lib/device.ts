import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { DEMO_MODE, store } from "@/lib/data";
import type { Device } from "@/lib/domain/devices";

/** Long-lived cookie that marks a browser as a registered site device. Holds a random token; only its hash is stored. */
export const DEVICE_COOKIE = "phoco_dev";
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers allow

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newDeviceToken = () => randomBytes(32).toString("base64url");

/** The registered device this browser belongs to, if any (active or removed). Demo mode has no device check. */
export async function currentDevice(): Promise<Device | null> {
  if (DEMO_MODE) return null;
  const token = cookies().get(DEVICE_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  return (await store().deviceByToken(sha256(token))) ?? null;
}
