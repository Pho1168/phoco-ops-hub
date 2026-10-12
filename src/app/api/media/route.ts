import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { canDraft, imageKind, PHOTO_MAX_BYTES } from "@/lib/domain/library";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

const dimension = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 10_000 ? n : undefined;
};

/**
 * A photo for an SOP step, already made smaller on the phone or tablet (the page sends JPEG with its width and height).
 * Only people who write SOPs, on the full app. The bytes must really be an image; the size is capped.
 */
export async function POST(req: Request) {
  const ctx = await current();
  if (!ctx || ctx.scope !== "full" || ctx.person.pinMustChange || !canDraft(ctx.person)) {
    return NextResponse.json({ ok: false, error: "Only managers can add photos" }, { status: 403 });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > PHOTO_MAX_BYTES) return NextResponse.json({ ok: false, error: "That photo is too big" }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES) return NextResponse.json({ ok: false, error: "That photo is too big or empty" }, { status: 413 });
  const mime = imageKind(bytes);
  if (!mime) return NextResponse.json({ ok: false, error: "That isn't a photo the app can use (JPEG, PNG or WebP)" }, { status: 415 });
  const width = dimension(req.headers.get("x-width")), height = dimension(req.headers.get("x-height"));
  if (!width || !height) return NextResponse.json({ ok: false, error: "The photo's size is missing" }, { status: 400 });
  const id = await store().addMedia({ mime, bytes, width, height, createdBy: ctx.person.id });
  return NextResponse.json({ ok: true, id, w: width, h: height });
}
