import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { managedSites } from "@/lib/domain/access";
import { sameBusinessIds } from "@/lib/domain/brand";
import { clampRange } from "@/lib/domain/records";
import { describeRule } from "@/lib/domain/temperature";
import { londonDate, londonHM } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";
import { current } from "@/lib/session";
import { loadRecords } from "../data";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  // Quote everything; neutralise spreadsheet formulas typed into notes.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** The temperature log or sign-off log as a CSV file, for owners and managers of the site. */
export async function GET(req: Request) {
  const ctx = await current();
  if (!ctx || ctx.scope !== "full") return new NextResponse("Sign in first", { status: 401 });
  const url = new URL(req.url);
  const site = url.searchParams.get("site") as SiteId;
  if (!sameBusinessIds(managedSites(ctx.person), await store().sites(), ctx.site).includes(site)) return new NextResponse("Not allowed", { status: 403 });
  const { from, to } = clampRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, londonDate(Date.now()), 7);
  const r = await loadRecords(site, from, to);
  const kind = url.searchParams.get("kind") === "signoffs" ? "signoffs" : "temps";
  const rows: unknown[][] = kind === "temps"
    ? [["Date", "Time", "Checklist", "Check", "Reading (°C)", "Limit", "Result", "Re-checked to (°C)", "Corrective action", "Action by", "Recorded by"],
       ...r.readings.map((x) => [x.date, londonHM(x.at), x.listName, x.itemText, x.value, x.ruleCode && r.rules[x.ruleCode] ? describeRule(r.rules[x.ruleCode]) : "",
         x.outcome === "ok" ? "OK" : x.outcome === "warn" ? "Above target" : "Out of limit", x.correctedTo ?? "", x.action ?? "", x.actionByName ?? "", x.byName])]
    : [["Date", "Checklist", "Area", "Due", "Status", "Signed at", "Signed by", "Checks done", "Checks total"],
       ...r.signoffs.map((x) => [x.date, x.listName, x.area, x.due ?? "", x.status.replace("_", " "), x.signedAt ? `${londonDate(x.signedAt)} ${londonHM(x.signedAt)}` : "", x.signedByName ?? "", x.answered, x.total])];
  await store().audit({ actorId: ctx.person.id, siteId: site, action: "records.export", detail: `Downloaded ${kind === "temps" ? "temperature log" : "sign-off log"} ${from} to ${to}` });
  return new NextResponse("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${site}-${kind === "temps" ? "temperatures" : "signoffs"}-${from}-to-${to}.csv"` },
  });
}
