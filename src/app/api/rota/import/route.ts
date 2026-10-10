import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/data";
import { sha256 } from "@/lib/device";
import { importRota } from "@/lib/rota-service";

export const dynamic = "force-dynamic";

const Grid = z.array(z.array(z.string().max(500)).max(60)).max(6000);
const Upload = z.object({ export: Grid, weeks: Grid, staff: Grid });

/** Called by the script in each site's rota Google Sheet. The token decides which site it is. */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 100) return NextResponse.json({ ok: false, error: "Missing token" }, { status: 401 });
  const siteId = await store().rotaSourceByToken(sha256(token));
  if (!siteId) return NextResponse.json({ ok: false, error: "This sheet isn't connected. Create a new connection on the Owner screen" }, { status: 401 });
  const parsed = Upload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "The sheet sent something unexpected" }, { status: 400 });
  const r = await importRota(siteId, parsed.data);
  return NextResponse.json({ ok: true, site: siteId, shifts: r.shifts, added: r.added, changed: r.changed, cancelled: r.cancelled, messages: r.notices, issues: r.issues });
}
