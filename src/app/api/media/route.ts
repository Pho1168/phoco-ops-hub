import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { canDraft, jpegSize, PHOTO_DAILY_LIMIT, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE } from "@/lib/domain/library";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/** Reads the upload, giving up as soon as it passes `max` bytes (whatever its content-length said). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | undefined> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return undefined; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/**
 * A photo for an SOP step (or, with ?for=stock, a stock report line or a receipt), made smaller on the phone or tablet first (a JPEG, at most 1600 px on the long side). Only
 * people who write SOPs, on the full app, and up to PHOTO_DAILY_LIMIT a day each. The bytes must really be a JPEG,
 * and its width and height are read from the file itself.
 */
export async function POST(req: Request) {
  const ctx = await current();
  // Stock photos (a report line, a receipt): anyone signed in, on the tablet or their own phone. Others: SOP writers on the full app.
  const forStock = new URL(req.url).searchParams.get("for") === "stock";
  if (!ctx || ctx.person.pinMustChange || ctx.person.status !== "active") return fail(403, "Sign in again");
  if (!forStock && (ctx.scope !== "full" || !canDraft(ctx.person))) return fail(403, "Only managers can add photos");
  if (Number(req.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) return fail(413, "That photo is too big");
  const db = store();
  // A quick refusal before reading the photo; adding it checks again, as one step.
  if ((await db.mediaCountSince(ctx.person.id, Date.now() - 86_400_000)) >= PHOTO_DAILY_LIMIT) {
    return fail(429, `That's ${PHOTO_DAILY_LIMIT} photos in a day. Try again tomorrow`);
  }
  const bytes = await readCapped(req, PHOTO_MAX_BYTES);
  if (!bytes) return fail(413, "That photo is too big");
  if (!bytes.length) return fail(400, "The photo was empty. Try again");
  const size = jpegSize(bytes);
  if (!size) return fail(415, "That isn't a photo the app can use. Take it again, or choose a JPEG or PNG");
  if (size.w > PHOTO_MAX_SIDE || size.h > PHOTO_MAX_SIDE) return fail(413, "That photo is too big");
  const id = await db.addMedia({ bytes, width: size.w, height: size.h, createdBy: ctx.person.id }, { max: PHOTO_DAILY_LIMIT, since: Date.now() - 86_400_000 });
  if (!id) return fail(429, `That's ${PHOTO_DAILY_LIMIT} photos in a day. Try again tomorrow`);
  return NextResponse.json({ ok: true, id, w: size.w, h: size.h });
}
