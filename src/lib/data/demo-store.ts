import { randomUUID } from "node:crypto";
import library from "../../../data/checklist-library.json";
import { hashPin } from "@/lib/domain/pin";
import type { Area, Checklist, ChecklistItem, Person, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, HandoverItem, Run, Session, Store } from "./store";

/** Demo-only people. Real staff come from the database, never from the code. */
export const DEMO_PINS = { owner: "2580", staff: "1357" } as const;

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
    runs: new Map(), alerts: [], handover: [], audit: [],
  };
}

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

  async createSession(personId, siteId, ttlMs) {
    const s: Session = { id: randomUUID(), personId, siteId, startedAt: Date.now(), expiresAt: Date.now() + ttlMs };
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
      if (match.exceptPersonIds?.includes(s.personId)) continue;
      s.revokedAt = Date.now(); s.revokedReason = reason; n++;
    }
    return n;
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
  async addHandover(h) { S().handover.unshift({ ...h, id: randomUUID(), createdAt: Date.now() }); },
  async closeHandover(id, personId) { const h = S().handover.find((x) => x.id === id); if (h && !h.closedAt) { h.closedAt = Date.now(); h.closedBy = personId; } },

  async audit(entry) { S().audit.unshift({ ...entry, at: Date.now() }); },
  async auditLog(limit) { return S().audit.slice(0, limit); },
};
