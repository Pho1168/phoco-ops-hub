import { describe, expect, it } from "vitest";
import { classifyReading, parseReading } from "./temperature";
import { canSignOff, evaluateAnswer, progress, runState } from "./checklist";
import { canFreeze, canSignIn, isPinLocked, planSiteClosure, registerPinFailure, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from "./access";
import { buildEveningNotices, buildImportNotices, buildTeamWeek, parseExport, parseStaffTab, parseWeekTable, planSync, weekStartOf, type StoredShift, type TeamShift } from "./rota";
import { afterQuietHours, londonToUtc } from "./time";
import { hashPin, isValidPin, verifyPin } from "./pin";
import { canUseDeviceForSite, formatPairCode, makePairCode, normalizePairCode, sessionDeviceOk, PAIR_ALPHABET, type Device } from "./devices";
import { canChangeAccess, canMarkLeft, nextStaffCode, normalizeStaffCode, validatePersonInput } from "./staff";
import { canUndo, canUsePrep, filterPrep, masterItems, planSubmit, reportOrder, PREP_CATEGORIES, PREP_MASTER, type PrepEntry } from "./prep";
import { readFileSync } from "node:fs";
import { clampRange, datesBetween, readingLog, recordsSummary, signoffLog, type RawAnswer } from "./records";
import { managedSites, canManage } from "./access";
import { currentNotes, noteOrder, notesForHandover, INFO_NOTE_MAX_HOURS } from "./handover";
import type { Answer, Checklist, Person, Site, TempRule } from "./types";

const FRIDGE: TempRule = { code: "F", label: "Fridge", targetMax: 5, legalMax: 8 };
const FREEZER: TempRule = { code: "Z", label: "Freezer", targetMax: -18 };
const COOK: TempRule = { code: "C", label: "Cook", targetMin: 75, legalMin: 75 };
const RULES = { F: FRIDGE, Z: FREEZER, C: COOK };

describe("temperature rules", () => {
  it("fridge: target, warning band and legal breach", () => {
    expect(classifyReading(3.1, FRIDGE)).toBe("ok");
    expect(classifyReading(5, FRIDGE)).toBe("ok");
    expect(classifyReading(6.2, FRIDGE)).toBe("warn");
    expect(classifyReading(8, FRIDGE)).toBe("warn");
    expect(classifyReading(8.1, FRIDGE)).toBe("bad");
  });
  it("freezer has no legal limit so never critical", () => {
    expect(classifyReading(-19.5, FREEZER)).toBe("ok");
    expect(classifyReading(-16, FREEZER)).toBe("warn");
  });
  it("cooking below 75°C is critical", () => {
    expect(classifyReading(75, COOK)).toBe("ok");
    expect(classifyReading(74.9, COOK)).toBe("bad");
  });
  it("parses what staff type", () => {
    expect(parseReading("9,4")).toBe(9.4);
    expect(parseReading("−18.5")).toBe(-18.5);
    expect(parseReading("4°C")).toBe(4);
    expect(parseReading("abc")).toBeNaN();
  });
});

const LIST: Checklist = {
  id: "T", siteId: "EAS", name: "Temps", area: "BOH", when: "Opening", due: "11:00", suggested: false,
  items: [
    { id: "i1", position: 1, section: "Cold", text: "Fridge 1", type: "temp", ruleCode: "F" },
    { id: "i2", position: 2, section: "Cold", text: "Door seals", type: "tick" },
  ],
};
const ans = (itemId: string, outcome: Answer["outcome"], t: number, action?: string): Answer =>
  ({ itemId, value: "x", outcome, recordedBy: "p", capturedAt: t, action });

describe("checklist", () => {
  it("rejects implausible readings", () => {
    const r = evaluateAnswer(LIST.items[0], "94", RULES);
    expect(r.ok).toBe(true);
    const bad = evaluateAnswer(LIST.items[0], "940", RULES);
    expect(bad.ok).toBe(false);
  });
  it("blocks sign-off until critical readings have an action", () => {
    const a = [ans("i1", "bad", 1), ans("i2", "done", 2)];
    expect(canSignOff(LIST, a, false)).toEqual({ allowed: false, reason: "1 reading needs a recorded action" });
    const fixed = [ans("i1", "bad", 1, "Moved food to another fridge"), ans("i2", "done", 2)];
    expect(canSignOff(LIST, fixed, false)).toEqual({ allowed: true });
  });
  it("the latest answer wins (corrections are new rows)", () => {
    const a = [ans("i1", "bad", 1), ans("i1", "ok", 5), ans("i2", "done", 2)];
    expect(progress(LIST, a)).toMatchObject({ answered: 2, needsAction: 0, critical: 0 });
  });
  it("overdue only after the due time and only if unfinished", () => {
    const p = progress(LIST, [ans("i2", "done", 1)]);
    expect(runState(p, false, "11:00", "10:59")).toBe("in_progress");
    expect(runState(p, false, "11:00", "11:01")).toBe("overdue");
    expect(runState(p, true, "11:00", "23:00")).toBe("done");
  });
});

const site = (id: Site["id"], status: Site["status"] = "open"): Site => ({ id, name: id, kind: "restaurant", status });
const person = (id: string, access: Person["access"], status: Person["status"] = "active"): Person =>
  ({ id, staffCode: id, name: id, status, pinFailed: 0, access });

describe("access and site lockdown", () => {
  const owner = person("own", [{ siteId: "EAS", role: "owner", sections: [] }, { siteId: "WEM", role: "owner", sections: [] }]);
  const easOnly = person("a", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }]);
  const both = person("b", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }]);
  const wemOnly = person("c", [{ siteId: "WEM", role: "staff", sections: ["PROD"] }]);

  it("closing a site freezes single-site staff, keeps multi-site staff and owners", () => {
    const plan = planSiteClosure("EAS", [owner, easOnly, both, wemOnly], new Set(["WEM"] as const));
    expect(plan).toEqual({ freeze: ["a"], endSessionsOnly: ["b"], untouched: ["own"] });
  });
  it("staff cannot sign in to a closed site, owners can", () => {
    expect(canSignIn(easOnly, site("EAS", "closed"), 0).allowed).toBe(false);
    expect(canSignIn(owner, site("EAS", "closed"), 0).allowed).toBe(true);
    expect(canSignIn(both, site("WEM"), 0).allowed).toBe(true);
  });
  it("frozen accounts and wrong sites are refused", () => {
    expect(canSignIn(person("f", easOnly.access, "frozen"), site("EAS"), 0).allowed).toBe(false);
    expect(canSignIn(wemOnly, site("EAS"), 0).allowed).toBe(false);
  });
  it("locks after repeated wrong PINs", () => {
    let p = easOnly;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) p = { ...p, ...registerPinFailure(p, 1000) };
    expect(p.pinLockedUntil).toBeGreaterThan(1000);
    expect(canSignIn(p, site("EAS"), 1001).allowed).toBe(false);
  });
  it("owner cannot freeze themself or the last owner", () => {
    expect(canFreeze(owner, owner, [owner, easOnly]).allowed).toBe(false);
    expect(canFreeze(owner, easOnly, [owner, easOnly]).allowed).toBe(true);
  });
});

describe("PINs", () => {
  it("hashes and verifies, rejects weak PINs", () => {
    const h = hashPin("4821");
    expect(verifyPin("4821", h)).toBe(true);
    expect(verifyPin("4822", h)).toBe(false);
    expect(isValidPin("1111")).toBe(false);
    expect(isValidPin("1234")).toBe(false);
    expect(isValidPin("4821")).toBe(true);
    expect(isValidPin("48210")).toBe(false);
  });
});

describe("rota import", () => {
  const header = ["Week starting", "Week #", "Slot", "Rota row", "Name", "Section"];
  const row = (name: string, section: string, days: Record<number, [string, string]>, checks = "0", week = "05/10/2026") => {
    const r = [week, "1", "1", "8", name, section, "", "", "", "", "", "", "", "", checks];
    for (let d = 0; d < 7; d++) r.push(...(days[d] ?? ["", ""]));
    return r;
  };
  const staffTab = [["PHO & CO  ·  EAS STAFF LIST"], ["Name", "Section", "Active", "Slot key", "Notes", "Capacity", "Staff ID"],
    ["Alex", "FOH", "Yes", "FOH1", "", "", "001"], ["Alex", "BOH", "Yes", "BOH1", "", "", "001"], ["Bo", "BOH", "Yes", "BOH2", "", "", ""]];
  const staff = parseStaffTab(staffTab);

  it("reads the Staff tab and the Settings week table like the real sheet", () => {
    expect(staff).toEqual([
      { name: "Alex", section: "FOH", staffCode: "001", active: true },
      { name: "Alex", section: "BOH", staffCode: "001", active: true }]);
    const weeks = parseWeekTable([["1", "Mon 5 Oct 2026", "4", "8", "16", "28", "29", "Published"], ["2", "Mon 12 Oct 2026", "33", "37", "45", "57", "58", "Draft"], ["Week #", "Week starting"]]);
    expect(Array.from(weeks.entries())).toEqual([["2026-10-05", "published"], ["2026-10-12", "draft"]]);
  });
  it("turns Export rows into dated shifts and flags problems", () => {
    const { shifts, issues } = parseExport("EAS", [
      header,
      row("Alex", "FOH", { 1: ["11:00", "21:45"], 4: ["17:00", "21:00"] }),
      row("Alex", "BOH", { 3: ["9:00", "21:30"] }),
      row("Sam", "BOH", { 0: ["11:00", "15:00"] }),
      row("Alex", "FOH", { 0: ["25:00", "22:00"] }),
      row("Alex", "FOH", { 2: ["11:00", "22:00"] }, "1"),
      row("", "", {}),
    ], staff);
    expect(shifts.map((s) => `${s.section} ${s.week} ${s.date} ${s.start}-${s.end}`)).toEqual([
      "FOH 2026-10-05 2026-10-06 11:00-21:45", "FOH 2026-10-05 2026-10-09 17:00-21:00", "BOH 2026-10-05 2026-10-08 09:00-21:30",
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "Sam (BOH) has no Staff ID in the Staff tab",
      'Alex, Mon 5 Oct: times "25:00–22:00" aren\'t valid',
      "Alex (FOH), week of Mon 5 Oct: the sheet flags this row (Checks), so it wasn't imported",
    ]);
  });

  const sh = (date: string, start: string, end: string, week = "2026-10-12"): StoredShift =>
    ({ sourceKey: `EAS|${week}|001|FOH|${date}`, staffCode: "001", section: "FOH", week, date, start, end, endsNextDay: false, cancelled: false });

  it("plans adds, changes and cancellations, only within the imported weeks", () => {
    const old = [sh("2026-10-13", "11:00", "21:45"), sh("2026-10-14", "11:00", "22:00"), sh("2026-10-06", "11:00", "15:00", "2026-10-05"), { ...sh("2026-10-16", "17:00", "21:00"), cancelled: true }];
    const next = [sh("2026-10-13", "12:00", "20:00"), sh("2026-10-16", "17:00", "21:00"), sh("2026-10-17", "11:00", "22:00")];
    const plan = planSync(old, next, new Set(["2026-10-12"]));
    expect(plan.changed.map((c) => `${c.before.start}->${c.after.start}`)).toEqual(["11:00->12:00"]);
    expect(plan.added.map((s) => s.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(plan.cancelled.map((s) => s.date)).toEqual(["2026-10-14"]);
  });
  it("messages: a newly published week sends one list; changes in published weeks send one message; drafts send nothing", () => {
    const imported = [sh("2026-10-13", "12:00", "20:00"), sh("2026-10-16", "17:00", "21:00")];
    const first = buildImportNotices({ siteName: "Eastcote", today: "2026-10-10", plan: { added: imported, changed: [], cancelled: [] }, imported,
      before: new Map([["2026-10-12", "draft"]]), after: new Map([["2026-10-12", "published"]]) });
    expect(first).toEqual([{ staffCode: "001", kind: "published", title: "Rota out: Eastcote, week of Mon 12 Oct", body: "Tue 13 Oct 12:00–20:00 (FOH)\nFri 16 Oct 17:00–21:00 (FOH)" }]);
    const plan = { added: [], changed: [{ before: sh("2026-10-13", "11:00", "21:45"), after: imported[0] }], cancelled: [sh("2026-10-15", "11:00", "15:00"), sh("2026-10-09", "11:00", "15:00")] };
    const pub = new Map([["2026-10-12", "published" as const]]);
    const later = buildImportNotices({ siteName: "Eastcote", today: "2026-10-10", plan, imported, before: pub, after: pub });
    expect(later).toEqual([{ staffCode: "001", kind: "changed", title: "Rota change at Eastcote", body: "Tue 13 Oct is now 12:00–20:00 (was 11:00–21:45)\nCancelled: Thu 15 Oct 11:00–15:00 (FOH)" }]);
    const draft = new Map([["2026-10-12", "draft" as const]]);
    expect(buildImportNotices({ siteName: "Eastcote", today: "2026-10-10", plan, imported, before: draft, after: draft })).toEqual([]);
  });
  it("evening reminder lists tomorrow's shifts per person", () => {
    const n = buildEveningNotices("2026-10-13", [
      { staffCode: "001", siteName: "Eastcote", section: "FOH", start: "17:00", end: "21:00", date: "2026-10-13" },
      { staffCode: "001", siteName: "Eastcote", section: "BOH", start: "09:00", end: "13:00", date: "2026-10-13" },
      { staffCode: "002", siteName: "Wembley", section: "PROD", start: "08:00", end: "16:00", date: "2026-10-14" }]);
    expect(n).toEqual([{ staffCode: "001", kind: "evening", title: "Tomorrow (Tue 13 Oct)", body: "Eastcote: 09:00–13:00 (BOH)\nEastcote: 17:00–21:00 (FOH)" }]);
  });
});

describe("London time", () => {
  it("converts wall-clock times across BST and GMT", () => {
    expect(new Date(londonToUtc("2026-10-13", "11:00")).toISOString()).toBe("2026-10-13T10:00:00.000Z");
    expect(new Date(londonToUtc("2026-12-01", "11:00")).toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });
  it("holds messages in quiet hours until 08:00", () => {
    const noon = londonToUtc("2026-10-13", "12:00");
    expect(afterQuietHours(noon)).toBe(noon);
    expect(new Date(afterQuietHours(londonToUtc("2026-10-13", "23:10"))).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(new Date(afterQuietHours(londonToUtc("2026-10-14", "06:00"))).toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });
});
describe("PIN lockout shared by sign-in and sign-off", () => {
  it("locks after the maximum attempts and unlocks after the lock period", () => {
    let p = { pinFailed: 0, pinLockedUntil: undefined as number | undefined };
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) p = { ...p, ...registerPinFailure(p as never, 1000) };
    expect(isPinLocked(p, 1000)).toBe(false);
    p = { ...p, ...registerPinFailure(p as never, 1000) };
    expect(isPinLocked(p, 1001)).toBe(true);
    expect(isPinLocked(p, 1000 + PIN_LOCK_MINUTES * 60_000 + 1)).toBe(false);
  });
});

describe("staff management", () => {
  const SITES: Site[] = [site("EAS"), { ...site("WEM"), kind: "production" }];
  const owner = person("own", [{ siteId: "EAS", role: "owner", sections: [] }]);
  const cook = { ...person("cook", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }]), staffCode: "003" };

  it("cleans input and keeps only sections that exist at each site", () => {
    const r = validatePersonInput({ name: "  Mai  Tran ", staffCode: "9", access: [
      { siteId: "EAS", role: "staff", sections: ["FOH", "PROD"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }] }, SITES, [owner, cook]);
    expect(r).toEqual({ ok: true, value: { name: "Mai Tran", staffCode: "009", access: [
      { siteId: "EAS", role: "staff", sections: ["FOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }] } });
  });
  it("rejects a taken staff ID, a bad ID, no sites and no sections", () => {
    const base = { name: "X", staffCode: "003", access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["FOH" as const] }] };
    expect(validatePersonInput(base, SITES, [cook]).ok).toBe(false);
    expect(validatePersonInput(base, SITES, [cook], "cook").ok).toBe(true);
    expect(validatePersonInput({ ...base, staffCode: "1234" }, SITES, []).ok).toBe(false);
    expect(validatePersonInput({ ...base, access: [] }, SITES, []).ok).toBe(false);
    expect(validatePersonInput({ ...base, access: [{ siteId: "EAS", role: "staff", sections: [] }] }, SITES, []).ok).toBe(false);
  });
  it("keeps at least one owner and stops owners demoting or removing themselves", () => {
    const owner2 = person("own2", owner.access);
    expect(canChangeAccess(owner, owner, cook.access, [owner, owner2]).ok).toBe(false);
    expect(canChangeAccess(owner2, owner, cook.access, [owner]).ok).toBe(false);
    expect(canChangeAccess(owner2, owner, cook.access, [owner, owner2]).ok).toBe(true);
    expect(canMarkLeft(owner, owner, [owner, owner2]).ok).toBe(false);
    expect(canMarkLeft(owner, cook, [owner, cook]).ok).toBe(true);
  });
  it("reads staff IDs however they're typed or stored", () => {
    expect(["1", "01", "001", " 7 ", "PC-0001", "pc-0012"].map((x) => normalizeStaffCode(x))).toEqual(["001", "001", "001", "007", "001", "012"]);
    expect(normalizeStaffCode("1000")).toBeNull();
    expect(normalizeStaffCode("abc")).toBeNull();
    expect(normalizeStaffCode("")).toBeNull();
  });
  it("suggests the next staff ID", () => {
    expect(nextStaffCode([cook, { ...owner, staffCode: "000" }])).toBe("004");
    expect(nextStaffCode([])).toBe("001");
  });
});

describe("site devices", () => {
  const tablet: Device = { id: "d1", siteId: "EAS", label: "Kitchen tablet", status: "active", createdAt: 0 };
  it("reads pairing codes the way people type them", () => {
    expect(normalizePairCode(" abc-234 ")).toBe("ABC234");
    expect(normalizePairCode("ABC23")).toBeNull();
    expect(normalizePairCode("ABC10O")).toBeNull(); // 1, 0 and O are never used
    expect(formatPairCode("ABC234")).toBe("ABC-234");
  });
  it("makes codes only from the readable alphabet", () => {
    let i = 0;
    const code = makePairCode(() => (i++ % 10) / 10);
    expect(code).toHaveLength(6);
    for (const ch of code) expect(PAIR_ALPHABET).toContain(ch);
    expect(makePairCode(() => 0.9999)).toBe("999999");
  });
  it("only lets a registered, active device sign staff in to its own site", () => {
    expect(canUseDeviceForSite(tablet, "EAS").allowed).toBe(true);
    expect(canUseDeviceForSite(tablet, "WEM").allowed).toBe(false);
    expect(canUseDeviceForSite({ ...tablet, status: "locked" }, "EAS").allowed).toBe(false);
    expect(canUseDeviceForSite(null, "EAS").allowed).toBe(false);
  });
  it("ends sessions when their device is removed; device-less sessions are owners only", () => {
    expect(sessionDeviceOk("d1", tablet, false)).toBe(true);
    expect(sessionDeviceOk("d1", { ...tablet, status: "locked" }, true)).toBe(false);
    expect(sessionDeviceOk(undefined, undefined, true)).toBe(true);
    expect(sessionDeviceOk(undefined, undefined, false)).toBe(false);
    expect(sessionDeviceOk(undefined, undefined, false, "shifts")).toBe(true);
  });
});

describe("kitchen prep", () => {
  const items = masterItems();
  const entry = (itemId: string, extra: Partial<PrepEntry> = {}): PrepEntry =>
    ({ id: `e-${itemId}-${extra.handoverId ?? "h"}`, handoverId: "h", siteId: "EAS", itemId, status: "outstanding", urgent: false, createdBy: "p", createdAt: 1, ...extra });

  it("has all 63 items exactly once, each in one of the five categories", () => {
    expect(PREP_MASTER).toHaveLength(63);
    expect(new Set(PREP_MASTER.map((r) => r[0])).size).toBe(63);
    expect(new Set(PREP_MASTER.map((r) => r[1].toLowerCase())).size).toBe(63);
    const counts = PREP_CATEGORIES.map((c) => items.filter((i) => i.category === c.id).length);
    expect(counts).toEqual([17, 17, 6, 14, 9]);
  });
  it("seeds the database with the same list", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/0006_kitchen_prep.sql", import.meta.url), "utf8");
    for (const [id, name, cat] of PREP_MASTER) expect(sql).toContain(`('${id}', '${name.replace(/'/g, "''")}', '${cat}',`);
  });
  it("filters by category and search words, ignoring case and order", () => {
    expect(filterPrep(items, "all", "")).toHaveLength(63);
    expect(filterPrep(items, "sauces", "")).toHaveLength(6);
    expect(filterPrep(items, "all", "S/V pork").map((i) => i.id)).toEqual(["kp-051", "kp-053"]);
    expect(filterPrep(items, "all", "ONION").map((i) => i.id)).toEqual(["kp-020", "kp-021", "kp-029", "kp-032"]);
    expect(filterPrep(items, "drinks", "onion")).toHaveLength(0);
    expect(filterPrep([...items.slice(0, 2), { ...items[2], active: false }], "all", "oil").map((i) => i.id)).toEqual(["kp-001", "kp-002"]);
  });
  it("lets everyone at the site use the board, front and back of house", () => {
    expect(canUsePrep({ siteId: "EAS", role: "staff", sections: ["BOH"] })).toBe(true);
    expect(canUsePrep({ siteId: "EAS", role: "staff", sections: ["FOH"] })).toBe(true);
    expect(canUsePrep({ siteId: "EAS", role: "manager", sections: ["FOH"] })).toBe(true);
    expect(canUsePrep(undefined)).toBe(false);
  });
  it("carries outstanding items into the next handover once, keeping urgency and notes", () => {
    const draft = [entry("kp-007", { id: "d7", handoverId: "new" }), entry("kp-040", { id: "d40", handoverId: "new", urgent: false })];
    const old = [entry("kp-040", { id: "o40", handoverId: "old", urgent: true, note: "Last tub" }), entry("kp-063", { id: "o63", handoverId: "old" })];
    const plan = planSubmit(draft, old, items.map((i) => i.id));
    expect(plan.carryIn).toEqual([{ itemId: "kp-063", from: "o63", urgent: false, note: undefined }]);
    expect(plan.merge).toEqual([{ entryId: "d40", from: "o40", urgent: true, note: "Last tub" }]);
    expect(plan.markCarried.sort()).toEqual(["o40", "o63"]);
    expect(plan.missed.map((e) => e.itemId).sort()).toEqual(["kp-040", "kp-063"]);
    expect(plan.stockedCount).toBe(60); // 63 minus rice, peanuts and lemonade
  });
  it("never duplicates an item that is outstanding twice", () => {
    const old = [entry("kp-001", { id: "a", createdAt: 1 }), entry("kp-001", { id: "b", createdAt: 2 })];
    const plan = planSubmit([], old, ["kp-001", "kp-002"]);
    expect(plan.carryIn).toHaveLength(1);
    expect(plan.carryIn[0].from).toBe("b");
    expect(plan.markCarried.sort()).toEqual(["a", "b"]);
    expect(plan.stockedCount).toBe(1);
  });
  it("a handover with nothing needed confirms every active item as stocked", () => {
    expect(planSubmit([], [], items.map((i) => i.id)).stockedCount).toBe(63);
  });
  it("orders the report urgent first, then in list order", () => {
    const list = [entry("kp-063"), entry("kp-001"), entry("kp-040", { urgent: true })];
    expect(reportOrder(list, items).map((e) => e.itemId)).toEqual(["kp-040", "kp-001", "kp-063"]);
  });
  it("allows undoing a completed item for 10 minutes", () => {
    expect(canUndo(1_000, 1_000 + 9 * 60_000)).toBe(true);
    expect(canUndo(1_000, 1_000 + 11 * 60_000)).toBe(false);
    expect(canUndo(undefined, 1_000)).toBe(false);
  });
});

describe("handover notes", () => {
  const H = 3_600_000;
  const now = 100 * H;
  const note = (createdAt: number, needsAction: boolean, extra: { closedAt?: number; category?: string } = {}) => ({ createdAt, needsAction, category: "Equipment", ...extra });

  it("keeps needs-action notes until they're ticked, however old", () => {
    const old = note(now - 30 * 24 * H, true);
    expect(currentNotes([old], [now - 2 * H, now - 26 * H], now)).toEqual([old]);
    expect(currentNotes([{ ...old, closedAt: now - H }], [], now)).toEqual([]);
  });
  it("shows a for-info note until a second handover is sent after it", () => {
    const info = note(now - 20 * H, false);
    expect(currentNotes([info], [], now)).toHaveLength(1);                       // nothing sent yet
    expect(currentNotes([info], [now - 10 * H], now)).toHaveLength(1);          // its own handover sent: next shift sees it
    expect(currentNotes([info], [now - H, now - 10 * H], now)).toHaveLength(0); // another handover since: gone
  });
  it(`drops for-info notes after ${INFO_NOTE_MAX_HOURS} hours where no handover is sent`, () => {
    expect(currentNotes([note(now - (INFO_NOTE_MAX_HOURS - 1) * H, false)], [], now)).toHaveLength(1);
    expect(currentNotes([note(now - (INFO_NOTE_MAX_HOURS + 1) * H, false)], [], now)).toHaveLength(0);
  });
  it("puts the notes written since the previous handover on a report", () => {
    const a = note(5 * H, false), b = note(15 * H, true), c = note(25 * H, false);
    expect(notesForHandover([a, b, c], 20 * H, 10 * H)).toEqual([b]);
    expect(notesForHandover([a, b, c], 20 * H, undefined)).toEqual([a, b]);
  });
  it("orders food safety first, then needs action, then newest", () => {
    const list = [note(1, false), note(2, true), note(3, false, { category: "Food safety" }), note(4, true)];
    expect(noteOrder(list).map((n) => n.createdAt)).toEqual([3, 4, 2, 1]);
  });
});

describe("team rota", () => {
  const staff = [{ name: "Anthony", section: "FOH", staffCode: "001", active: true }];
  const row = (hrsMon: string, start: string, end: string) => {
    const r = Array(31).fill("");
    r[0] = "12/10/2026"; r[4] = "Anthony"; r[5] = "FOH"; r[6] = hrsMon; r[14] = "0"; r[15] = start; r[16] = end;
    return r;
  };
  it("keeps the paid hours from the sheet", () => {
    const { shifts } = parseExport("EAS", [row("9.75", "11:00", "22:15")], staff);
    expect(shifts[0]).toMatchObject({ date: "2026-10-12", start: "11:00", end: "22:15", hours: 9.75 });
  });
  it("updates stored hours without messaging staff when only the break changes", () => {
    const old: StoredShift = { ...parseExport("EAS", [row("9.75", "11:00", "22:15")], staff).shifts[0], cancelled: false, hours: undefined };
    const now = parseExport("EAS", [row("10.75", "11:00", "22:15")], staff).shifts;
    const plan = planSync([old], now, new Set(["2026-10-12"]));
    expect(plan.changed).toHaveLength(1);
    const pub = new Map([["2026-10-12", "published" as const]]);
    expect(buildImportNotices({ siteName: "Eastcote", today: "2026-10-11", plan, imported: now, before: pub, after: pub })).toHaveLength(0);
  });
  it("finds the Monday of a week", () => {
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-14")).toBe("2026-10-12");
  });
  const t = (personId: string, name: string, section: string, date: string, start: string, end: string, hours: number): TeamShift => ({ personId, name, section, date, start, end, hours });
  const shifts = [
    t("v", "Vishal", "BOH", "2026-10-12", "09:00", "22:15", 11.75),
    t("p", "Priyanshi", "FOH", "2026-10-12", "11:00", "22:15", 9.75),
    t("a", "Anthony", "FOH", "2026-10-13", "11:00", "22:15", 9.75),
    t("a", "Anthony", "BOH", "2026-10-14", "11:00", "21:30", 9),
    t("x", "Old", "BOH", "2026-10-19", "11:00", "22:15", 9.75),
  ];
  it("lays the week out FOH first, one row per person per section, with totals for managers", () => {
    const w = buildTeamWeek("2026-10-12", shifts, true);
    expect(w.rows.map((r) => `${r.name} ${r.section}`)).toEqual(["Priyanshi FOH", "Anthony FOH", "Vishal BOH", "Anthony BOH"]);
    expect(w.dayHours).toEqual([21.5, 9.75, 9, 0, 0, 0, 0]);
    expect(w.weekHours).toBe(40.25);
    expect(w.onShift).toEqual([2, 1, 1, 0, 0, 0, 0]);
    expect(w.people).toBe(3);
    expect(w.byDay[0].shifts.map((s) => s.name)).toEqual(["Vishal", "Priyanshi"]);
  });
  it("hides hours from staff", () => {
    const w = buildTeamWeek("2026-10-12", shifts, false);
    expect(w.dayHours).toBeUndefined();
    expect(w.weekHours).toBeUndefined();
    expect(w.rows.flatMap((r) => r.days.flat()).every((s) => s!.hours === undefined)).toBe(true);
  });
});

describe("inspection records", () => {
  const base = { listId: "L", listName: "BOH Opening", date: "2026-10-12", itemId: "fridge1", itemText: "Fridge 1", itemType: "temp" as const, ruleCode: "F", byName: "Vishal" };
  const at = (hm: string) => londonToUtc("2026-10-12", hm);
  it("keeps every reading and attaches the corrective action to the reading it was for", () => {
    const rows: RawAnswer[] = [
      { ...base, value: "9", outcome: "bad", at: at("10:00") },
      { ...base, value: "9", outcome: "bad", at: at("10:05"), action: "Moved stock to fridge 2, engineer called", actionByName: "Vishal" },
      { ...base, value: "4", outcome: "ok", at: at("11:00") },
      { ...base, itemId: "tick", itemType: "tick", value: "yes", outcome: "done", at: at("10:01") },
    ];
    const log = readingLog(rows);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ value: "9", outcome: "bad", action: "Moved stock to fridge 2, engineer called", correctedTo: "4" });
    expect(log[1]).toMatchObject({ value: "4", outcome: "ok" });
    expect(log[1].action).toBeUndefined();
  });
  it("lists days newest first", () => {
    expect(datesBetween("2026-10-10", "2026-10-12")).toEqual(["2026-10-12", "2026-10-11", "2026-10-10"]);
  });
  const lists = [{ id: "OPEN", name: "Opening", area: "BOH" as const, due: "11:00" }, { id: "CLOSE", name: "Closing", area: "BOH" as const, due: "22:30" }];
  it("marks sign-offs on time, late, not signed or still open, from the day tracking started", () => {
    const runs = [
      { listId: "OPEN", date: "2026-10-11", signedAt: londonToUtc("2026-10-11", "10:50"), signedByName: "A", answered: 10, total: 10 },
      { listId: "CLOSE", date: "2026-10-11", signedAt: londonToUtc("2026-10-12", "00:20"), signedByName: "B", answered: 8, total: 8 },
      { listId: "OPEN", date: "2026-10-12", answered: 3, total: 10 },
    ];
    const now = londonToUtc("2026-10-12", "15:00");
    const rows = signoffLog(lists, runs, datesBetween("2026-10-09", "2026-10-12"), now, "2026-10-11");
    const st = (d: string, id: string) => rows.find((r) => r.date === d && r.listId === id)?.status;
    expect(st("2026-10-11", "OPEN")).toBe("on_time");
    expect(st("2026-10-11", "CLOSE")).toBe("late");          // signed after midnight
    expect(st("2026-10-12", "OPEN")).toBe("not_signed");     // past 11:00 and not signed
    expect(st("2026-10-12", "CLOSE")).toBe("open");          // due 22:30, still time
    expect(rows.some((r) => r.date < "2026-10-11")).toBe(false); // before tracking started
    expect(signoffLog(lists, [], ["2026-10-12"], now, undefined)).toEqual([]);
    // No due time (deliveries, weekly cleans): only shown once started; unfinished on an earlier day = not signed.
    const adhoc = [{ id: "DELIVERY", name: "Delivery", area: "BOH" as const }];
    expect(signoffLog(adhoc, [], datesBetween("2026-10-10", "2026-10-12"), now, "2026-10-10")).toEqual([]);
    expect(signoffLog(adhoc, [{ listId: "DELIVERY", date: "2026-10-11", answered: 2, total: 5 }], ["2026-10-11"], now, "2026-10-10")[0].status).toBe("not_signed");
    const sum = recordsSummary([], rows);
    expect([sum.onTime, sum.late, sum.notSigned]).toEqual([1, 1, 1]);
  });
  it("keeps the date range sensible", () => {
    expect(clampRange(undefined, undefined, "2026-10-12", 7)).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(clampRange("2026-10-20", "2026-10-30", "2026-10-12", 7)).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(clampRange("2025-01-01", "2026-10-12", "2026-10-12", 7).from).toBe("2026-07-12");
    expect(clampRange("bad", "worse", "2026-10-12", 28)).toEqual({ from: "2026-09-15", to: "2026-10-12" });
  });
  it("lets owners and managers manage their own sites only", () => {
    const mgr = { access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }, { siteId: "WEM" as const, role: "staff" as const, sections: [] }] };
    expect(managedSites(mgr)).toEqual(["EAS"]);
    expect(canManage(mgr, "WEM")).toBe(false);
  });
});
