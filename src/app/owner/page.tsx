import Link from "next/link";
import { BRANDS, brandOf, inBrand } from "@/lib/domain/brand";
import { DEMO_MODE, store } from "@/lib/data";
import { currentDevice } from "@/lib/device";
import { DevicesCard, type DeviceRow } from "./DevicesCard";
import { RotaCard, type RotaRow } from "./RotaCard";
import { shortDay } from "@/lib/domain/time";
import { progress, runState } from "@/lib/domain/checklist";
import { londonNow, requireLead } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { OwnerClient, type SiteSummary, type PersonRow } from "./OwnerClient";
import { ManageTiles, NeedsYou } from "../manage/ManageTiles";
import { manageCounts } from "../manage/counts";
import { RemindersCard } from "./RemindersCard";
import { RightNow } from "./RightNow";
import { AvailabilityBanner, AvailabilityCard } from "@/components/AvailabilityCard";
import { rotaSitesOf } from "@/lib/availability-service";
import { askedWeek, asksAvailability, latestAvailability } from "@/lib/domain/availability";
import { cleaningBoards } from "@/lib/cleaning-service";
import { cleaningSummary } from "@/lib/domain/cleaning";
import { teamRowsView, teamToday } from "@/lib/team-today";
import { gasFor, lastClose, readyFor, shiftsAround } from "@/lib/daily-service";
import { closeWords, readyShownUntil } from "@/lib/domain/daily";
import { londonHM } from "@/lib/domain/time";
import { accountsFor, canManageAccount, ROLE_SHORT } from "@/lib/domain/staff";
import { activityFor } from "@/lib/domain/activity";
import { rotaGoneQuiet } from "@/lib/domain/rota";

export const dynamic = "force-dynamic";

/**
 * The overview: owners see every site; an operations manager sees the sites they run, without closing sites,
 * connecting rota sheets or changing owner and operations manager accounts (those stay with the owner).
 */
export default async function Owner() {
  const ctx = await requireLead();
  const db = store();
  const { date, hm } = londonNow();
  const now = Date.now();
  const [everyone, around, allSites] = await Promise.all([db.people(), shiftsAround(now, db), db.sites()]);
  const all = accountsFor(ctx.person, everyone);
  const sites = allSites.filter((s) => ctx.leads.includes(s.id) && (s.id !== "SYD" || s.status === "open"));
  const cleaning = await cleaningBoards(db, sites.filter((s) => s.status === "open").map((s) => s.id), now);
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
    const open = (await db.alerts(s.id)).filter((a) => !a.resolvedAt);
    const alerts = open.map((a) => ({ id: a.id, title: a.title, detail: a.detail, critical: a.level === "critical" }));
    // The light shows until an hour after the ready time, as on Today.
    const showReady = !!s.readyBy && now < readyShownUntil(date, s.readyBy);
    const [ready, gas, last] = await Promise.all([
      showReady ? readyFor(s, now, db, { shifts: around, lists: states, alerts: open, people: everyone }) : undefined,
      gasFor(s, now, db, { shifts: around }), lastClose(s, now, db, { shifts: around }),
    ]);
    const by = (c: { personName: string; createdAt: number; onTablet: boolean }) => `${c.personName} at ${londonHM(c.createdAt)}${c.onTablet ? " on the tablet" : " on their phone"}`;
    const gasLine = gas && gas.state !== "later" && gas.state !== "missed"
      ? gas.check ? { text: `Gas off: checked by ${by(gas.check)}`, tone: "good" as const }
        : gas.state === "overdue" ? { text: `Gas check not done · ${closeWords(gas.day)} at ${londonHM(gas.day.closeAt)}`, tone: "bad" as const }
        : { text: `Gas check due now · ${gas.day.kitchen ? "the kitchen closes" : "the last shift ends"} at ${londonHM(gas.day.closeAt)}`, tone: "" as const }
      : last ? last.check ? { text: `Last close: gas off, checked by ${by(last.check)}`, tone: "good" as const } : { text: "Last close: no gas-off check", tone: "bad" as const }
      : undefined;
    const board = cleaning.get(s.id);
    const c = board ? cleaningSummary(board) : undefined;
    const cleaningLine = c ? {
      text: `Weekly cleaning: ${c.complete} of ${c.total} done${c.late ? ` · ${c.late} due now` : c.soon ? ` · ${c.soon} due soon` : ""}${c.missedLast ? ` · ${c.missedLast} missed last time` : ""}`,
      tone: c.late || c.missedLast ? "bad" as const : c.complete === c.total ? "good" as const : "" as const,
    } : undefined;
    return { id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason, lists: lists.length, signed, overdue, alerts, ready, gas: gasLine, gasBy: s.gasBy, cleaning: cleaningLine };
  }));
  const names = new Map(everyone.map((p) => [p.id, p.name]));
  const order = { active: 0, frozen: 1, left: 2 } as const;
  // Staff accounts of the business of the site they're working at (someone at both businesses is on both).
  const biz = brandOf(ctx.site).id;
  const people: PersonRow[] = [...all].filter((p) => inBrand(p, biz, allSites) || !p.access.length).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)).map((p) => ({
    id: p.id, name: p.name, code: p.staffCode, status: p.status, self: p.id === ctx.person.id,
    sites: p.access.map((a) => `${a.siteId} ${ROLE_SHORT[a.role].toLowerCase()}`).join(" · "),
    canEdit: canManageAccount(ctx.person, p).ok,
    brands: [biz],
  }));
  // An operations manager's log: their sites and their own actions (more are read so 30 are left after filtering).
  // Only this business's activity: its sites' entries, and anything not tied to a site.
  const log = activityFor(ctx.person, await db.auditLog(300), ctx.leads).filter((e) => !e.siteId || (ctx.leads as string[]).includes(e.siteId)).slice(0, 30).map((e) => ({
    at: new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }), site: e.siteId ?? "", who: e.actorId ? names.get(e.actorId) ?? "" : "", action: e.action, detail: e.detail,
  }));
  const here = await currentDevice();
  const siteName = new Map(allSites.map((s) => [s.id, s.name]));
  const fmt = (t?: number) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "never");
  const devices: DeviceRow[] = (await db.devices()).filter((d) => ctx.leads.includes(d.siteId)).map((d) => ({
    id: d.id, label: d.label, site: siteName.get(d.siteId) ?? d.siteId, status: d.status, lastSeen: fmt(d.lastSeen), current: d.id === here?.id,
  }));
  const sources = await db.rotaSources();
  const rota: RotaRow[] = sites.filter((s) => s.status === "open").map((s) => {
    const src = sources.find((x) => x.siteId === s.id);
    const r = src?.lastResult;
    return {
      siteId: s.id, site: s.name, connected: !!src, last: src?.lastImportAt ? fmt(src.lastImportAt) : undefined,
      quiet: !!src && rotaGoneQuiet(src, now),
      summary: r ? `${r.shifts} shifts · ${r.added} new · ${r.changed} changed · ${r.cancelled} cancelled · ${r.notices} messages` : undefined,
      published: r?.published.length ? r.published.map((w) => `week of ${shortDay(w)}`).join(", ") : undefined,
      issues: r?.issues ?? [],
    };
  });
  const openSites = sites.filter((s) => s.status === "open");
  const teamRows = await teamToday(openSites.map((s) => s.id), now);
  const team = teamRowsView(teamRows, now);
  const withPush = await db.peopleWithPush();
  const active = all.filter((p) => p.status === "active" && inBrand(p, biz, allSites));
  const lead = ctx.isOwner ? "owner" as const : "ops" as const;
  const missing = active.filter((p) => !withPush.has(p.id)).map((p) => p.name);
  const counts = await manageCounts(ctx.person, ctx.site);
  // The first glance: urgent things, sites ready to open, prep still to do, who's on (and late or not coming).
  const prepSites = (await db.prepEnabledSites()).filter((id) => openSites.some((s) => s.id === id));
  const prepOpen = (await Promise.all(prepSites.map((id) => db.prepOutstanding(id)))).flat();
  const withReady = summaries.filter((s) => s.ready);
  // Operations managers are asked for their availability too (owners aren't).
  const availWeek = askedWeek(now);
  const availAsked = asksAvailability(ctx.person, allSites, await rotaSitesOf(db, ctx.person, now));
  const availSent = availAsked && latestAvailability(await db.myAvailability(ctx.person.id, [availWeek])).has(ctx.person.id);
  const rightNowCard = (
    <RightNow urgent={counts.urgent ?? 0}
      ready={withReady.length ? { green: withReady.filter((s) => s.ready!.light === "green").length, of: withReady.length } : undefined}
      prep={prepSites.length ? { toDo: prepOpen.length, urgent: prepOpen.filter((e) => e.urgent).length } : undefined}
      team={{ onRota: teamRows.length, late: teamRows.filter((r) => r.reply?.kind === "late").length, cantMakeIt: teamRows.filter((r) => r.reply?.kind === "cant_make_it").length }}
    />
  );
  const rightNow = <>{availAsked && !availSent && <AvailabilityBanner week={availWeek} now={now} />}{rightNowCard}{availAsked && availSent && <AvailabilityCard week={availWeek} sent now={now} />}</>;
  return (
    <>
      <TopBar ctx={ctx} neutral title="Right now" eyebrow={lead === "owner" ? `${BRANDS[biz].name} · owner` : `${sites.map((s) => s.name).join(" · ")} · operations`}>
        {ctx.site.status === "open" && <Link className="pill-btn top-extra" href="/shift?view=lanes">Lanes at {ctx.site.name}</Link>}
      </TopBar>
      <OwnerClient lead={lead} rightNow={rightNow} needs={<NeedsYou counts={counts} />} tools={<ManageTiles counts={counts} owner={ctx.isOwner} />}
        reminders={<RemindersCard rows={team} active={active.length} pushOn={active.length - missing.length} missing={missing} />} sites={summaries} people={people} log={log} currentSite={ctx.site.id}
        rota={<RotaCard rows={rota} canConnect={ctx.isOwner} />}
        devices={<DevicesCard devices={devices} demo={DEMO_MODE} sites={sites.filter((s) => s.status === "open").map((s) => ({ id: s.id, name: s.name }))} />} />
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
