import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { newDeviceToken } from "@/lib/device";
import { tick } from "@/lib/rota-service";

export const dynamic = "force-dynamic";

/** Called every 10 minutes by the Supabase scheduler with the token stored in app_secrets ("cron"). */
export async function POST(req: Request) {
  const given = Buffer.from((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim());
  const expected = Buffer.from(await store().secret("cron", newDeviceToken));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await tick()) });
}
