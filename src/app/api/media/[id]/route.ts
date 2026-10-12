import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

/** What a photo the owner has erased shows instead (brand sage and green). */
const REMOVED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#DCE3D6"/>`
  + `<text x="200" y="158" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#2F4A3A">Photo removed</text></svg>`;

/**
 * A photo, for anyone signed in (tablet or own phone). The browser keeps it for 10 minutes, then checks it's still
 * the same (a quick "not changed" answer), so a photo the owner erases disappears from every device soon after.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  const { id } = await props.params;
  const db = store();
  const info = await db.mediaInfo(id);
  if (!info) return new NextResponse("Not found", { status: 404 });
  const headers = (erased: boolean) => ({ etag: `"${id}${erased ? "-removed" : ""}"`, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" });
  const removed = () => new NextResponse(REMOVED, { headers: { ...headers(true), "content-type": "image/svg+xml", "content-security-policy": "default-src 'none'" } });
  if (req.headers.get("if-none-match") === headers(info.erased).etag) return new NextResponse(null, { status: 304, headers: headers(info.erased) });
  if (info.erased) return removed();
  const m = await db.media(id);
  if (!m) return new NextResponse("Not found", { status: 404 });
  if (m.erased) return removed(); // erased a moment ago
  return new NextResponse(Buffer.from(m.bytes), { headers: { ...headers(false), "content-type": m.mime } });
}
