import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { progress, runState } from "@/lib/domain/checklist";
import { londonNow, requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { OwnerClient, type SiteSummary, type PersonRow } from "./OwnerClient";

export const dynamic = "force-dynamic";

export default async function Owner() {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/today");
  const db = store();
  const { date, hm } = londonNow();
  const sites = (await db.sites()).filter((s) => s.id !== "SYD" || s.status === "open");
  const summaries: SiteSummary[] = await Promise.all(sites.map(async (s) => {
    const lists = await db.checklists(s.id);
    let signed = 0, overdue = 0;
    for (const l of lists) {
      const run = await db.run(l.id, date);
      const st = runState(progress(l, run.answers), !!run.signedAt, l.due, hm);
      if (st === "done") signed++;
      if (st === "overdue") overdue++;
    }
    const alerts = (await db.alerts(s.id)).filter((a) => !a.resolvedAt).map((a) => ({ id: a.id, title: a.title, detail: a.detail, critical: a.level === "critical" }));
    return { id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason, lists: lists.length, signed, overdue, alerts };
  }));
  const all = await db.people();
  const names = new Map(all.map((p) => [p.id, p.name]));
  const order = { active: 0, frozen: 1, left: 2 } as const;
  const people: PersonRow[] = [...all].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)).map((p) => ({
    id: p.id, name: p.name, code: p.staffCode, status: p.status, self: p.id === ctx.person.id,
    sites: p.access.map((a) => `${a.siteId} ${a.role}`).join(" · "),
  }));
  const log = (await db.auditLog(30)).map((e) => ({
    at: new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }), site: e.siteId ?? "", who: e.actorId ? names.get(e.actorId) ?? "" : "", action: e.action, detail: e.detail,
  }));
  return (
    <>
      <TopBar ctx={ctx} />
      <OwnerClient sites={summaries} people={people} log={log} currentSite={ctx.site.id} />
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
