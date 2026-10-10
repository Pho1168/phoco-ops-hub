import webpush from "web-push";
import { store } from "@/lib/data";

/**
 * Web push. The VAPID key pair (it identifies this app to the phone's push service) is generated on first
 * use and kept in the database, so there is nothing to configure on the hosting side.
 */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const raw = await store().secret("vapid", () => JSON.stringify(webpush.generateVAPIDKeys()));
  return JSON.parse(raw);
}

export interface PushPayload { title: string; body: string; url: string }

/** Sends to every phone the person turned reminders on for. Dead subscriptions are removed. */
export async function pushToPerson(personId: string, payload: PushPayload): Promise<number> {
  const db = store();
  const subs = await db.pushSubs(personId);
  if (!subs.length) return 0;
  const keys = await vapidKeys();
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: "mailto:admin@phoandco.com", publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 12 * 60 * 60,
        urgency: "normal",
      });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.dropPushSub(s.endpoint); // phone unsubscribed or app removed
    }
  }
  return sent;
}
