import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A photo, for anyone signed in (tablet or own phone). Photos never change, so the browser keeps them. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  const { id } = await props.params;
  const m = await store().media(id);
  if (!m) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(m.bytes), {
    headers: { "content-type": m.mime, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
