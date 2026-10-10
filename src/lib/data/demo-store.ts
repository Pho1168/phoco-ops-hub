import { randomUUID } from "node:crypto";
import library from "../../../data/checklist-library.json";
import { hashPin } from "@/lib/domain/pin";
import type { Area, Checklist, ChecklistItem, Person, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, HandoverItem, NoticeRow, PrepEntryView, PrepHandover, PushSub, RotaResult, Run, Session, ShiftView, Store } from "./store";
import { masterItems, type PrepEntry, type PrepItem } from "@/lib/domain/prep";
import type { StoredShift, WeekStatus } from "@/lib/domain/rota";
import type { Device } from "@/lib/domain/devices";

/** Demo-only people. Real staff come from the database, never from the code. */
export const DEMO_PINS = { owner: "4826", staff: "1357" } as const;

const DUE: Record<string, string> = {
  "EAS-FOH-OPEN": "11:30", "EAS-FOH-CLOSE": "22:30", "EAS-FOH-CLEAN": "22:30", "EAS-BAR-PREP": "11:30",
  "EAS-BOH-OPEN": "11:00", "EAS-BOH-CLOSE": "22:30", "EAS-BOH-CLEAN": "22:30", "EAS-TEMP-COLD": "11:00",
  "EAS-TEMP-COOK": "12:00", "WEM-OPEN": "08:00", "WEM-CLOSE": "17:00", "WEM-CLEAN": "17:00",
  "WEM-TEMP-COLD": "08:00", "WEM-TEMP-COOK": "10:00", "WEM-DISPATCH": "10:30",
};

interface LibItem { text: string; type: ChecklistItem["type"]; limit?: string; hint?: string; tag?: string }
interface LibList { id: string; name: string; area: Area; when: string; tag?: string; sections: [string, LibItem[]][] }
type Lib = Record<string, { name: string; checklists: LibList[] }>;

function ruleFor(limit?: string): string | undefined {
  if (!limit) return undefined;
  if (limit.includes("-18")) return "Z";
  if (limit.includes("75")) return "C";
  if (limit.includes("5°C")) return "F";
  return undefined;
}

function buildChecklists(): Checklist[] {
  const out: Checklist[] = [];
  for (const [siteId, site] of Object.entries(library as unknown as Lib)) {
    for (const c of site.checklists) {
      let pos = 0;
      const items: ChecklistItem[] = [];
      for (const [section, its] of c.sections) for (const it of its) {
        pos++;
        items.push({
          id: `${c.id}#${pos}`, position: pos, section, text: it.text, type: it.type,
          ruleCode: it.type === "temp" ? ruleFor(it.limit) : undefined,
          hint: it.hint || (it.type === "temp" ? undefined : it.limit) || undefined,
          tag: it.tag || (c.tag === "new" ? "new" : undefined),
        });
      }
      out.push({ id: c.id, siteId: siteId as SiteId, name: c.name, area: c.area, when: c.when, due: DUE[c.id], suggested: c.tag === "new", items });
    }
  }
  return out;
}

interface State {
  sites: Site[]; people: Person[]; sessions: Session[]; lists: Checklist[]; rules: Record<string, TempRule>;
  runs: Map<string, Run>; alerts: Alert[]; handover: HandoverItem[]; audit: AuditEntry[];
  devices: (Device & { tokenHash: string })[];
  pairings: { codeHash: string; siteId: SiteId; label: string; createdBy: string; expiresAt: number; usedAt?: number }[];
  rotaSources: { siteId: SiteId; tokenHash: string; createdAt: number; lastImportAt?: number; lastResult?: RotaResult }[];
  weeks: Map<string, WeekStatus>; // "SITE|week"
  shifts: (StoredShift & { id: string; siteId: SiteId; personId: string })[];
  notices: (NoticeRow & { dedupeKey?: string })[];
  pushSubs: PushSub[];
  secrets: Map<string, string>;
  prepItems: PrepItem[]; prepSites: SiteId[];
  prepHandovers: Omit<PrepHandover, "entries" | "createdByName" | "submittedByName">[];
  prepEntries: PrepEntry[];
}

function seed(): State {
  const owner = hashPin(DEMO_PINS.owner), staff = hashPin(DEMO_PINS.staff);
  const p = (id: string, name: string, access: Person["access"], pin: string): Person =>
    ({ id, staffCode: id, name, status: "active", pinFailed: 0, pinHash: pin, access });
  return {
    sites: [
      { id: "EAS", name: "Eastcote", kind: "restaurant", status: "open" },
      { id: "WEM", name: "Wembley", kind: "production", status: "open" },
      { id: "SYD", name: "Sydenham", kind: "restaurant", status: "closed", closedReason: "Closed until it reopens" },
    ],
    people: [
      p("DEMO-OWN", "Owner (demo)", [{ siteId: "EAS", role: "owner", sections: ["FOH", "BOH"] }, { siteId: "WEM", role: "owner", sections: ["PROD"] }, { siteId: "SYD", role: "owner", sections: [] }], owner),
      p("DEMO-FOH", "FOH staff (demo)", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }], staff),
      p("DEMO-BOH", "BOH staff (demo)", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }], staff),
      p("DEMO-MGR", "Manager (demo)", [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }], staff),
      p("DEMO-PRD", "Wembley cook (demo)", [{ siteId: "WEM", role: "staff", sections: ["PROD"] }], staff),
      p("DEMO-FLT", "Floater (demo)", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }], staff),
    ],
    sessions: [],
    lists: buildChecklists(),
    // Placeholder limits until the owner confirms them against the approved HACCP plan.
    rules: {
      F: { code: "F", label: "Fridge / chilled", targetMax: 5, legalMax: 8 },
      Z: { code: "Z", label: "Freezer", targetMax: -18 },
      C: { code: "C", label: "Cooking core", targetMin: 75, legalMin: 75 },
    },
    runs: new Map(), alerts: [], handover: [], audit: [], devices: [], pairings: [],
    rotaSources: [], weeks: new Map(), shifts: [], notices: [], pushSubs: [], secrets: new Map(),
    prepItems: masterItems(), prepSites: ["EAS"], prepHandovers: [], prepEntries: [],
  };
}

/** Never hand the token hash out of the store. */
const publicDevice = (d: Device & { tokenHash: string }): Device =>
  ({ id: d.id, siteId: d.siteId, label: d.label, status: d.status, lastSeen: d.lastSeen, createdAt: d.createdAt });

const nameOf = (id?: string) => (id ? S().people.find((p) => p.id === id)?.name ?? "" : undefined);
const prepView = (e: PrepEntry): PrepEntryView => ({ ...e, createdByName: nameOf(e.createdBy) ?? "", completedByName: nameOf(e.completedBy) });
function prepFull(id: string): PrepHandover | undefined {
  const h = S().prepHandovers.find((x) => x.id === id);
  if (!h) return undefined;
  return { ...h, createdByName: nameOf(h.createdBy) ?? "", submittedByName: nameOf(h.submittedBy), entries: S().prepEntries.filter((e) => e.handoverId === id).map(prepView) };
}
const prepOpen = (siteId: SiteId) => S().prepEntries.filter((e) => e.siteId === siteId && e.status === "outstanding"
  && S().prepHandovers.find((h) => h.id === e.handoverId)?.status === "submitted");

const g = globalThis as unknown as { __phocoDemo?: State };
const S = (): State => (g.__phocoDemo ??= seed());

export function resetDemo() { g.__phocoDemo = seed(); }

export const demoStore: Store = {
  async sites() { return S().sites; },
  async site(id) { return S().sites.find((s) => s.id === id); },
  async setSiteStatus(id, status, reason) {
    const s = S().sites.find((x) => x.id === id);
    if (s) { s.status = status; s.closedReason = status === "closed" ? reason : undefined; }
  },

  async people() { return S().people; },
  async person(id) { return S().people.find((p) => p.id === id); },
  async updatePerson(id, patch) { const p = S().people.find((x) => x.id === id); if (p) Object.assign(p, patch); },
  async createPerson({ staffCode, name, pinHash, pinMustChange, access }) {
    const id = randomUUID();
    S().people.push({ id, staffCode, name, status: "active", pinHash, pinMustChange, pinFailed: 0, access });
    return id;
  },
  async setAccess(personId, access) { const p = S().people.find((x) => x.id === personId); if (p) p.access = access; },

  async createSession(personId, siteId, ttlMs, deviceId, scope = "full") {
    const s: Session = { id: randomUUID(), personId, siteId, deviceId, scope, startedAt: Date.now(), expiresAt: Date.now() + ttlMs };
    S().sessions.push(s);
    return s;
  },
  async session(id) { return S().sessions.find((s) => s.id === id); },
  async revokeSessions(match, reason) {
    let n = 0;
    for (const s of S().sessions) {
      if (s.revokedAt) continue;
      if (match.personId && s.personId !== match.personId) continue;
      if (match.siteId && s.siteId !== match.siteId) continue;
      if (match.deviceId && s.deviceId !== match.deviceId) continue;
      if (match.exceptPersonIds?.includes(s.personId)) continue;
      if (match.exceptSessionId === s.id) continue;
      s.revokedAt = Date.now(); s.revokedReason = reason; n++;
    }
    return n;
  },

  async devices() { return S().devices.map(publicDevice); },
  async deviceByToken(tokenHash) {
    const d = S().devices.find((x) => x.tokenHash === tokenHash);
    if (!d) return undefined;
    d.lastSeen = Date.now();
    return publicDevice(d);
  },
  async device(id) { const d = S().devices.find((x) => x.id === id); return d ? publicDevice(d) : undefined; },
  async setDeviceStatus(id, status) { const d = S().devices.find((x) => x.id === id); if (d) d.status = status; },
  async createPairing(p) { S().pairings.push({ ...p }); },
  async redeemPairing(codeHash, tokenHash, now) {
    const p = S().pairings.find((x) => x.codeHash === codeHash && !x.usedAt && x.expiresAt > now);
    if (!p) return undefined;
    p.usedAt = now;
    const d = { id: randomUUID(), siteId: p.siteId, label: p.label, status: "active" as const, createdAt: now, lastSeen: now, tokenHash };
    S().devices.push(d);
    return publicDevice(d);
  },

  async rules() { return S().rules; },
  async checklists(siteId) { return S().lists.filter((l) => l.siteId === siteId); },
  async checklist(id) { return S().lists.find((l) => l.id === id); },
  async run(listId, date) {
    const k = `${date}|${listId}`;
    let r = S().runs.get(k);
    if (!r) { r = { listId, date, answers: [] }; S().runs.set(k, r); }
    return r;
  },
  async addAnswer(listId, date, answer) { (await this.run(listId, date)).answers.push(answer); },
  async signRun(listId, date, personId) { const r = await this.run(listId, date); r.signedBy = personId; r.signedAt = Date.now(); },

  async alerts(siteId) { return S().alerts.filter((a) => !siteId || a.siteId === siteId); },
  async raiseAlert(a) {
    if (S().alerts.some((x) => x.dedupeKey === a.dedupeKey && !x.resolvedAt)) return;
    S().alerts.unshift({ ...a, id: randomUUID(), createdAt: Date.now() });
  },
  async resolveAlert(id, personId, note) {
    const a = S().alerts.find((x) => x.id === id);
    if (a && !a.resolvedAt) { a.resolvedAt = Date.now(); a.resolvedBy = personId; a.resolutionNote = note; }
  },

  async handover(siteId) { return S().handover.filter((h) => h.siteId === siteId); },
  async addHandover(h) { S().handover.unshift({ ...h, createdByName: S().people.find((p) => p.id === h.createdBy)?.name ?? "", id: randomUUID(), createdAt: Date.now() }); },
  async closeHandover(id, personId) { const h = S().handover.find((x) => x.id === id); if (h && !h.closedAt) { h.closedAt = Date.now(); h.closedBy = personId; } },

  async prepItems() { return S().prepItems; },
  async prepEnabledSites() { return S().prepSites; },
  async prepDraft(siteId) { const h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft"); return h ? prepFull(h.id) : undefined; },
  async prepEditDraft(siteId, personId, change) {
    let h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft");
    const now = Date.now();
    if (!h) { h = { id: randomUUID(), siteId, shift: change.shift ?? "next", status: "draft", createdBy: personId, createdAt: now, updatedAt: now }; S().prepHandovers.push(h); }
    if (change.shift) h.shift = change.shift;
    h.updatedAt = now;
    if (!change.itemId) return;
    const i = S().prepEntries.findIndex((e) => e.handoverId === h!.id && e.itemId === change.itemId);
    if (change.needed === false) { if (i >= 0) S().prepEntries.splice(i, 1); return; }
    let e = i >= 0 ? S().prepEntries[i] : undefined;
    if (!e) { e = { id: randomUUID(), handoverId: h.id, siteId, itemId: change.itemId, status: "outstanding", urgent: false, createdBy: personId, createdAt: now }; S().prepEntries.push(e); }
    if (change.urgent !== undefined) e.urgent = change.urgent;
    if (change.note !== undefined) e.note = change.note || undefined;
  },
  async prepOutstanding(siteId) { return prepOpen(siteId).map(prepView); },
  async prepSubmit(siteId, personId, makePlan) {
    const h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft");
    if (!h) return undefined;
    const draft = S().prepEntries.filter((e) => e.handoverId === h.id);
    const plan = makePlan(draft, prepOpen(siteId), S().prepItems.filter((i) => i.active).map((i) => i.id));
    const now = Date.now();
    for (const c of plan.carryIn) S().prepEntries.push({ id: randomUUID(), handoverId: h.id, siteId, itemId: c.itemId, status: "outstanding", urgent: c.urgent, note: c.note, carriedFrom: c.from, createdBy: personId, createdAt: now });
    for (const m of plan.merge) { const e = S().prepEntries.find((x) => x.id === m.entryId); if (e) { e.carriedFrom = m.from; e.urgent = m.urgent; e.note = m.note; } }
    for (const id of plan.markCarried) { const e = S().prepEntries.find((x) => x.id === id); if (e) e.status = "carried"; }
    Object.assign(h, { status: "submitted", submittedBy: personId, submittedAt: now, updatedAt: now, stockedCount: plan.stockedCount });
    return { handoverId: h.id, plan };
  },
  async prepHandover(id) { return prepFull(id); },
  async prepHandovers(siteId, limit) {
    return S().prepHandovers.filter((h) => h.siteId === siteId && h.status === "submitted")
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)).slice(0, limit).map((h) => prepFull(h.id)!);
  },
  async prepSetDone(entryId, siteId, personId, done) {
    const e = S().prepEntries.find((x) => x.id === entryId && x.siteId === siteId && x.status === (done ? "outstanding" : "completed"));
    if (!e || S().prepHandovers.find((h) => h.id === e.handoverId)?.status !== "submitted") return false;
    if (done) { e.status = "completed"; e.completedBy = personId; e.completedAt = Date.now(); }
    else { e.status = "outstanding"; e.completedBy = undefined; e.completedAt = undefined; }
    return true;
  },

  async rotaSources() { return S().rotaSources.map((r) => ({ siteId: r.siteId, createdAt: r.createdAt, lastImportAt: r.lastImportAt, lastResult: r.lastResult })); },
  async rotaSourceByToken(tokenHash) { return S().rotaSources.find((r) => r.tokenHash === tokenHash)?.siteId; },
  async setRotaToken(siteId, tokenHash) {
    S().rotaSources = [...S().rotaSources.filter((r) => r.siteId !== siteId), { siteId, tokenHash, createdAt: Date.now() }];
  },
  async recordRotaImport(siteId, result) { const r = S().rotaSources.find((x) => x.siteId === siteId); if (r) { r.lastImportAt = Date.now(); r.lastResult = result; } },
  async weekStatuses(siteId) {
    const out = new Map<string, WeekStatus>();
    for (const [k, v] of Array.from(S().weeks.entries())) if (k.startsWith(`${siteId}|`)) out.set(k.slice(4), v);
    return out;
  },
  async setWeekStatuses(siteId, statuses) { for (const [w, st] of Array.from(statuses.entries())) S().weeks.set(`${siteId}|${w}`, st); },
  async siteShifts(siteId) {
    return S().shifts.filter((s) => s.siteId === siteId).map((s): StoredShift => ({ sourceKey: s.sourceKey, staffCode: s.staffCode, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end, endsNextDay: s.endsNextDay, cancelled: s.cancelled }));
  },
  async applyShiftSync(siteId, plan, personIdByCode) {
    for (const s of [...plan.added, ...plan.changed.map((c) => c.after)]) {
      const personId = personIdByCode.get(s.staffCode);
      if (!personId) continue;
      const i = S().shifts.findIndex((x) => x.sourceKey === s.sourceKey);
      const row = { ...s, id: i >= 0 ? S().shifts[i].id : randomUUID(), siteId, personId, cancelled: false };
      if (i >= 0) S().shifts[i] = row; else S().shifts.push(row);
    }
    for (const s of plan.cancelled) { const x = S().shifts.find((y) => y.sourceKey === s.sourceKey); if (x) x.cancelled = true; }
  },
  async shiftsForPerson(personId, fromDate, toDate) {
    const names = new Map(S().sites.map((s) => [s.id, s.name]));
    return S().shifts.filter((s) => s.personId === personId && s.date >= fromDate && s.date <= toDate)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map((s): ShiftView => ({ id: s.id, siteId: s.siteId, siteName: names.get(s.siteId) ?? s.siteId, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end,
        published: S().weeks.get(`${s.siteId}|${s.week}`) === "published", cancelled: s.cancelled }));
  },
  async shiftsOnDate(date) {
    const names = new Map(S().sites.map((s) => [s.id, s.name]));
    return S().shifts.filter((s) => s.date === date && !s.cancelled && S().weeks.get(`${s.siteId}|${s.week}`) === "published")
      .map((s) => ({ id: s.id, siteId: s.siteId, siteName: names.get(s.siteId) ?? s.siteId, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end,
        published: true, cancelled: false, personId: s.personId, staffCode: s.staffCode }));
  },
  async queueNotice(n) {
    if (n.dedupeKey && S().notices.some((x) => x.dedupeKey === n.dedupeKey)) return false;
    S().notices.push({ id: randomUUID(), personId: n.personId, kind: n.kind, title: n.title, body: n.body, dedupeKey: n.dedupeKey, sendAfter: n.sendAfter, createdAt: Date.now() });
    return true;
  },
  async dueNotices(now, limit) { return S().notices.filter((n) => !n.sentAt && n.sendAfter <= now).slice(0, limit); },
  async markNoticeSent(id) { const n = S().notices.find((x) => x.id === id); if (n) n.sentAt = Date.now(); },
  async notices(personId, limit) {
    return S().notices.filter((n) => n.personId === personId && n.sendAfter <= Date.now()).sort((a, b) => b.sendAfter - a.sendAfter).slice(0, limit);
  },
  async savePushSub(sub) { S().pushSubs = [...S().pushSubs.filter((p) => p.endpoint !== sub.endpoint), sub]; },
  async pushSubs(personId) { return S().pushSubs.filter((p) => p.personId === personId); },
  async dropPushSub(endpoint) { S().pushSubs = S().pushSubs.filter((p) => p.endpoint !== endpoint); },
  async secret(key, make) { if (!S().secrets.has(key)) S().secrets.set(key, make()); return S().secrets.get(key)!; },

  async audit(entry) { S().audit.unshift({ ...entry, at: Date.now() }); },
  async auditLog(limit) { return S().audit.slice(0, limit); },
};
