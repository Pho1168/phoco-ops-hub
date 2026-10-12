import { redirect } from "next/navigation";
import { DEMO_MODE, store } from "@/lib/data";
import { currentDevice } from "@/lib/device";
import { DevicesCard, type DeviceRow } from "./DevicesCard";
import { RotaCard, type RotaRow } from "./RotaCard";
import { shortDay } from "@/lib/domain/time";
import { progress, runState } from "@/lib/domain/checklist";
import { londonNow, requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { OwnerClient, type SiteSummary, type PersonRow } from "./OwnerClient";
import { ManageTiles } from "../manage/ManageTiles";
import { manageCounts } from "../manage/counts";
import { RemindersCard } from "./RemindersCard";
import { teamRowsView, teamToday } from "@/lib/team-today";
import { gasFor, lastClose, readyFor } from "@/lib/daily-service";
import { londonHM } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export default async function Owner() {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/today");
  const db = store();
  const { date, hm } = londonNow();
  const now = Date.now();
  const sites = (await db.sites()).filter((s) => s.id !== "SYD" || s.status === "open");
  const summaries: SiteSummary[] = await Promise.all(sites.map(async (s) => {
    const lists = await db.checklists(s.id);
    let signed = 0, overdue = 0;
    const states: { name: string; due?: string; signed: boolean }[] = [];
    for (const l of lists) {
      const run = await db.run(l.id, date);
      const st = runState(progress(l, run.answers), !!run.signedAt, l.due, hm);
      if (st === "done") signed++;
      if (st === "overdue") overdue++;
      states.push({ name: l.name, due: l.due, signed: !!run.signedAt });
    }
    const alerts = (await db.alerts(s.id)).filter((a) => !a.resolvedAt).map((a) => ({ id: a.id, title: a.title, detail: a.detail, critical: a.level === "critical" }));
    const [ready, gas, last] = await Promise.all([readyFor(s, now, db, states), gasFor(s, now), lastClose(s, now)]);
    const by = (c: { personName: string; createdAt: number; onTablet: boolean }) => `${c.personName} at ${londonHM(c.createdAt)}${c.onTablet ? " on the tablet" : " on their phone"}`;
    const gasLine = gas && gas.state !== "later" && gas.state !== "missed"
      ? gas.check ? { text: `Gas off: checked by ${by(gas.check)}`, tone: "good" as const }
        : gas.state === "overdue" ? { text: `Gas check not done · last shift ended ${londonHM(gas.day.closeAt)}`, tone: "bad" as const }
        : { text: `Gas check due now · last shift ends ${londonHM(gas.day.closeAt)}`, tone: "" as const }
      : last ? last.check ? { text: `Last close: gas off, checked by ${by(last.check)}`, tone: "good" as const } : { text: "Last close: no gas-off check", tone: "bad" as const }
      : undefined;
    return { id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason, lists: lists.length, signed, overdue, alerts, ready, gas: gasLine };
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
  const here = await currentDevice();
  const siteName = new Map((await db.sites()).map((s) => [s.id, s.name]));
  const fmt = (t?: number) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "never");
  const devices: DeviceRow[] = (await db.devices()).map((d) => ({
    id: d.id, label: d.label, site: siteName.get(d.siteId) ?? d.siteId, status: d.status, lastSeen: fmt(d.lastSeen), current: d.id === here?.id,
  }));
  const sources = await db.rotaSources();
  const rota: RotaRow[] = sites.filter((s) => s.status === "open").map((s) => {
    const src = sources.find((x) => x.siteId === s.id);
    const r = src?.lastResult;
    return {
      siteId: s.id, site: s.name, connected: !!src, last: src?.lastImportAt ? fmt(src.lastImportAt) : undefined,
      summary: r ? `${r.shifts} shifts · ${r.added} new · ${r.changed} changed · ${r.cancelled} cancelled · ${r.notices} messages` : undefined,
      published: r?.published.length ? r.published.map((w) => `week of ${shortDay(w)}`).join(", ") : undefined,
      issues: r?.issues ?? [],
    };
  });
  const team = teamRowsView(await teamToday(sites.filter((s) => s.status === "open").map((s) => s.id), now), now);
  const withPush = await db.peopleWithPush();
  const active = all.filter((p) => p.status === "active");
  const missing = active.filter((p) => !withPush.has(p.id)).map((p) => p.name);
  return (
    <>
      <TopBar ctx={ctx} />
      <OwnerClient tools={<ManageTiles counts={await manageCounts(ctx.person)} />}
        reminders={<RemindersCard rows={team} active={active.length} pushOn={active.length - missing.length} missing={missing} />} sites={summaries} people={people} log={log} currentSite={ctx.site.id}
        rota={<RotaCard rows={rota} />}
        devices={<DevicesCard devices={devices} demo={DEMO_MODE} sites={sites.filter((s) => s.status === "open").map((s) => ({ id: s.id, name: s.name }))} />} />
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
