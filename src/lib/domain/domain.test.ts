import { describe, expect, it } from "vitest";
import { classifyReading, describeRule, parseReading, raisesAlert } from "./temperature";
import { canSignOff, evaluateAnswer, progress, runState } from "./checklist";
import { canFreeze, canSignIn, isPinLocked, planSiteClosure, registerPinFailure, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from "./access";
import { buildEveningNotices, buildImportNotices, buildTeamWeek, parseExport, parseStaffTab, parseWeekTable, planSync, rotaGoneQuiet, weekStartOf, type StoredShift, type TeamShift } from "./rota";
import { afterQuietHours, dayMonthYear, daysBetween, isIsoDate, londonToUtc } from "./time";
import { hashPin, isValidPin, verifyPin } from "./pin";
import { canUseDeviceForSite, formatPairCode, makePairCode, normalizePairCode, sessionDeviceOk, PAIR_ALPHABET, type Device } from "./devices";
import { canChangeAccess, canMarkLeft, nextStaffCode, normalizeStaffCode, validatePersonInput } from "./staff";
import { BAR_ITEMS, canEditPrepList, canRetirePrepItem, canUndo, canUsePrep, cleanPrepItem, filterPrep, masterItems, moveTarget, planSubmit, prepGroups, reportOrder, PREP_MASTER, type PrepEntry } from "./prep";
import { readFileSync } from "node:fs";
import { canEditCerts, canSeeRightToWork, certReminderMessages, certStatus, expectedKinds, issueCount, peopleInCare, reminderDue, siteCover, statusText, suggestExpiry, validateCert, visibleTypes, CERT_KINDS, CERT_TYPES, type Certificate } from "./certificates";
import { canCancel, canDecide, clashes, daysOf, offOn, rangeLabel, validateRequest, type TimeOff } from "./timeoff";
import { audienceLabel, canPostTo, inAudience, isLive, readStats, unreadFor, type TeamNotice } from "./notices";
import { change, groupTotals, siteWeekReport, weeklyDigest, type SiteWeekInput } from "./report";
import { audienceText, canComplete, dueText, isForPerson, taskCentre, taskOrder, validateTask, TASK_CATEGORIES, type CentreInput, type Task } from "./tasks";
import { addMonths, canUseEquipment, downHours, downSince, faultReportedMessages, faultsOf, openFaults, safeNextPath, serviceReminderMessages, serviceState, sinceText,
  validateEquipment, validateService, EQUIPMENT_KINDS, type Equipment, type EquipmentEvent } from "./equipment";
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
  it("freezer with its -15°C limit (migration 0039): -17°C is above target, warmer than -15°C is past the limit", () => {
    const Z: TempRule = { ...FREEZER, legalMax: -15 };
    expect(classifyReading(-18, Z)).toBe("ok");
    expect(classifyReading(-17, Z)).toBe("warn");
    expect(classifyReading(-15, Z)).toBe("warn");
    expect(classifyReading(-14.9, Z)).toBe("bad");
    expect(classifyReading(17, Z)).toBe("bad"); // a typed 17 for -17 still flags, so it gets looked at
    expect(describeRule(Z)).toBe("≤ -18°C target · -15°C limit");
  });
  it("only a reading past the safe limit raises an alert", () => {
    expect(raisesAlert(classifyReading(6, FRIDGE))).toBe(false);
    expect(raisesAlert(classifyReading(8.5, FRIDGE))).toBe(true);
    expect(raisesAlert(classifyReading(-17, { ...FREEZER, legalMax: -15 }))).toBe(false);
    expect(raisesAlert(classifyReading(74, COOK))).toBe(true);
    expect(raisesAlert("ok")).toBe(false);
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
  it("a sheet has gone quiet after more than 2 hours without sending, from when it was connected if it never has", () => {
    const h = 3_600_000, now = 100 * h;
    expect(rotaGoneQuiet({ createdAt: 0, lastImportAt: now - 2 * h }, now)).toBe(false);
    expect(rotaGoneQuiet({ createdAt: 0, lastImportAt: now - 2 * h - 1 }, now)).toBe(true);
    expect(rotaGoneQuiet({ createdAt: now - h }, now)).toBe(false);
    expect(rotaGoneQuiet({ createdAt: now - 3 * h }, now)).toBe(true);
  });
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

  it("imports a kitchen's BOH rows as Production, matched on the sheet's own section", () => {
    const rows = [header, row("Alex", "BOH", { 3: ["9:00", "21:30"] }), row("Alex", "FOH", { 1: ["11:00", "21:45"] })];
    const kitchen = parseExport("WEM", rows, staff, { kitchen: true }).shifts;
    expect(kitchen.map((s) => `${s.section} ${s.sourceKey}`)).toEqual(["PROD WEM|2026-10-05|001|PROD|3", "FOH WEM|2026-10-05|001|FOH|1"]);
    expect(parseExport("WEM", rows, staff).shifts.map((s) => s.section)).toEqual(["BOH", "FOH"]);
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
    // urgent (kit not working, P1 task): still sent until midnight, then waits for 08:00
    expect(afterQuietHours(londonToUtc("2026-10-13", "23:10"), true)).toBe(londonToUtc("2026-10-13", "23:10"));
    expect(afterQuietHours(londonToUtc("2026-10-13", "22:30"), true)).toBe(londonToUtc("2026-10-13", "22:30"));
    expect(new Date(afterQuietHours(londonToUtc("2026-10-14", "00:20"), true)).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(afterQuietHours(noon, true)).toBe(noon);
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

  it("was seeded with 63 items in five groups, then the 22 bar and counter jobs", () => {
    expect(PREP_MASTER).toHaveLength(63);
    expect(new Set(items.map((r) => r.id)).size).toBe(85);
    expect(new Set(PREP_MASTER.map((r) => r[1].toLowerCase())).size).toBe(63);
    expect(prepGroups(items).map((g) => `${g.kind}|${g.group}|${items.filter((i) => i.kind === g.kind && i.group === g.group).length}`)).toEqual([
      "todo|Bar & counter|11", "prep|Cooking & kitchen prep|17", "prep|Fresh prep & vegetables|17", "prep|Sauces & condiments|6",
      "prep|Defrosting & replenishment|14", "prep|Drinks & desserts|9", "prep|Bar & counter|11",
    ]);
  });
  it("seeds the database with the same lists", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/0006_kitchen_prep.sql", import.meta.url), "utf8");
    for (const [id, name, cat] of PREP_MASTER) expect(sql).toContain(`('${id}', '${name.replace(/'/g, "''")}', '${cat}',`);
    const bar = readFileSync(new URL("../../../supabase/migrations/0024_handover_list.sql", import.meta.url), "utf8");
    BAR_ITEMS.forEach(([id, name, kind], i) => expect(bar).toContain(`('${id}', '${name.replace(/'/g, "''")}', '${kind}', 'Bar & counter', ${64 + i})`));
  });
  it("filters by group and search words, ignoring case and order: to do first, then to prep", () => {
    expect(filterPrep(items, "all", "")).toHaveLength(85);
    expect(filterPrep(items, "all", "")[0].id).toBe("kp-075");
    expect(filterPrep(items, "prep|Sauces & condiments", "")).toHaveLength(6);
    expect(filterPrep(items, "all", "S/V pork").map((i) => i.id)).toEqual(["kp-051", "kp-053"]);
    expect(filterPrep(items, "all", "ONION").map((i) => i.id)).toEqual(["kp-075", "kp-020", "kp-021", "kp-029", "kp-032", "kp-068"]);
    expect(filterPrep(items, "prep|Drinks & desserts", "onion")).toHaveLength(0);
    expect(filterPrep([...items.slice(0, 2), { ...items[2], active: false }], "all", "oil").map((i) => i.id)).toEqual(["kp-001", "kp-002"]);
  });
  it("managers edit the list; only the owner and operations managers take items off it", () => {
    const who = (role: "staff" | "manager" | "ops" | "owner") => ({ access: [{ siteId: "EAS" as const, role, sections: [] }] });
    expect([canEditPrepList(who("staff")), canEditPrepList(who("manager")), canEditPrepList(who("ops")), canEditPrepList(who("owner"))]).toEqual([false, true, true, true]);
    expect([canRetirePrepItem(who("manager")), canRetirePrepItem(who("ops")), canRetirePrepItem(who("owner"))]).toEqual([false, true, true]);
  });
  it("checks a new or changed item: a name, a list, a group; no repeats on the same list", () => {
    expect(cleanPrepItem({ name: "  Wipe   menus ", kind: "todo", group: "bar & COUNTER" }, items)).toEqual({ ok: true, value: { name: "Wipe menus", kind: "todo", group: "Bar & counter" } });
    expect(cleanPrepItem({ name: "Wipe menus", kind: "todo", group: "Front" }, items)).toEqual({ ok: true, value: { name: "Wipe menus", kind: "todo", group: "Front" } });
    expect(cleanPrepItem({ name: "cook rice", kind: "prep", group: "Cooking & kitchen prep" }, items)).toMatchObject({ ok: false, error: '"Cook rice" is already on the To prep list' });
    expect(cleanPrepItem({ name: "Cook rice", kind: "todo", group: "Rice" }, items).ok).toBe(true);
    expect(cleanPrepItem({ name: "Cook rice", kind: "prep", group: "Cooking & kitchen prep" }, items, "kp-007").ok).toBe(true); // itself
    expect(cleanPrepItem({ name: "", kind: "prep", group: "X" }, items)).toMatchObject({ ok: false, error: "Write what it is" });
    expect(cleanPrepItem({ name: "X", kind: "prep", group: " " }, items)).toMatchObject({ ok: false });
    expect(cleanPrepItem({ name: "X", kind: "bar", group: "X" }, items)).toMatchObject({ ok: false, error: "Choose To do or To prep" });
    expect(cleanPrepItem({ name: "x".repeat(81), kind: "prep", group: "X" }, items).ok).toBe(false);
  });
  it("moves an item up or down within its group only", () => {
    expect(moveTarget(items, "kp-002", "up")?.id).toBe("kp-001");
    expect(moveTarget(items, "kp-001", "up")).toBeUndefined();
    expect(moveTarget(items, "kp-017", "down")).toBeUndefined(); // last in its group
    expect(moveTarget(items, "kp-075", "down")?.id).toBe("kp-076");
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
    expect(plan.stockedCount).toBe(82); // 85 minus rice, peanuts and lemonade
  });
  it("a carried item stays with whoever it was for, also if it was picked again (done, then put back)", () => {
    const given = { assignedTo: "anh", assignedBy: "minh", assignedAt: 5 };
    const old = [entry("kp-063", { id: "o63", handoverId: "old", ...given }), entry("kp-040", { id: "o40", handoverId: "old", ...given }), entry("kp-001", { id: "o1", handoverId: "old", ...given })];
    const draft = [entry("kp-040", { id: "d40", handoverId: "new", assignedTo: "binh", assignedBy: "linh", assignedAt: 9 }), entry("kp-001", { id: "d1", handoverId: "new" })];
    const plan = planSubmit(draft, old, items.map((i) => i.id));
    expect(plan.carryIn).toEqual([{ itemId: "kp-063", from: "o63", urgent: false, note: undefined, ...given }]);
    // The review step shows (and changes) the waiting item, so that's what counts, not a pick it hides.
    expect(plan.merge.find((m) => m.entryId === "d40")).toMatchObject(given);
    expect(plan.merge.find((m) => m.entryId === "d1")).toMatchObject(given);
    const none = planSubmit([entry("kp-040", { id: "d40", assignedTo: "binh", assignedBy: "linh", assignedAt: 9 })], [entry("kp-040", { id: "o40" })], ["kp-040"]);
    expect(none.merge[0].assignedBy).toBeUndefined();
    // Taken off someone (by, no one named): stays for nobody.
    const off = planSubmit([], [entry("kp-002", { id: "o2", assignedBy: "minh", assignedAt: 7 })], ["kp-002"]);
    expect(off.carryIn[0]).toMatchObject({ assignedBy: "minh", assignedAt: 7 });
    expect(off.carryIn[0].assignedTo).toBeUndefined();
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
    expect(planSubmit([], [], items.map((i) => i.id)).stockedCount).toBe(85);
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

describe("weekly report", () => {
  const H = 3_600_000;
  const week = "2026-10-05";
  const now = londonToUtc("2026-10-12", "09:00");
  const reading = (itemText: string, outcome: "ok" | "warn" | "bad", action?: string) =>
    ({ date: "2026-10-06", at: now - 100 * H, listId: "L", listName: "Temps", itemId: itemText, itemText, value: "1", outcome, byName: "A", ...(action ? { action } : {}) });
  const signoff = (listName: string, status: "on_time" | "late" | "not_signed" | "open") => ({ date: "2026-10-06", listId: listName, listName, area: "BOH" as const, status, answered: 1, total: 1 });
  const input: SiteWeekInput = {
    week, now, trackingFrom: "2026-10-01",
    readings: [reading("Fridge 2", "bad", "Moved stock"), reading("Fridge 2", "warn"), reading("Fridge 1", "ok")],
    signoffs: [signoff("Opening", "on_time"), signoff("Opening", "on_time"), signoff("Closing", "late"), signoff("Clean", "not_signed"), signoff("Clean", "not_signed"), signoff("Toilets", "open")],
    alerts: [{ createdAt: now - 50 * H, resolvedAt: now - 47 * H, level: "critical" }, { createdAt: now - 5 * H, level: "warning" }],
    notes: [{ createdAt: now - 72 * H, closedAt: now - 20 * H, needsAction: true, category: "Equipment" }, { createdAt: now - 10 * H, needsAction: true, category: "Stock shortage" }, { createdAt: now - 10 * H, needsAction: false, category: "Other" }],
    prep: [{ submittedAt: now - 30 * H, entries: [{ status: "completed" }, { status: "carried" }, { status: "outstanding", carriedFrom: "x" }] }],
    shifts: [
      { personId: "a", name: "A", section: "FOH", date: "2026-10-05", start: "11:00", end: "22:15", hours: 9.75 },
      { personId: "b", name: "B", section: "BOH", date: "2026-10-05", start: "11:00", end: "22:15", hours: 9.75 },
      { personId: "b", name: "B", section: "BOH", date: "2026-10-06", start: "11:00", end: "15:00", hours: 4 },
    ],
  };
  const r = siteWeekReport(input);
  it("counts checks without the ones still open today", () => {
    expect(r.checks).toMatchObject({ expected: 5, onTime: 2, late: 1, notSigned: 2, onTimeRate: 40 });
    expect(r.checks.worst[0]).toEqual({ listName: "Clean", missed: 2 });
  });
  it("counts temperatures, alerts, handover and prep", () => {
    expect(r.temps).toMatchObject({ readings: 3, outOfRange: 2, critical: 1, withAction: 1 });
    expect(r.alerts).toMatchObject({ raised: 2, resolved: 1, open: 1, avgHoursToResolve: 3 });
    expect(r.handover).toMatchObject({ notes: 3, actions: 2, actionsDone: 1, slow: 1 });
    expect(r.prep).toEqual({ sent: 1, needed: 2, carried: 1 });
  });
  it("adds up planned hours by day and section", () => {
    expect(r.rota.hours).toBe(23.5);
    expect(r.rota.people).toBe(2);
    expect(r.rota.byDay.slice(0, 2)).toEqual([19.5, 4]);
    expect(r.rota.bySection).toEqual([{ section: "BOH", hours: 13.75 }, { section: "FOH", hours: 9.75 }]);
  });
  it("lists what needs attention, most serious first", () => {
    const texts = r.attention.map((a) => a.text);
    expect(r.attention[0].level).toBe("critical");
    expect(texts[0]).toBe("1 temperature reading outside the limits with no corrective action recorded");
    expect(texts).toContain("1 alert still open");
    expect(texts).toContain("Clean not signed off on 2 days");
    expect(texts).toContain("Fridge 2 out of range 2 times: worth checking the unit");
    expect(texts).toContain("1 prep item not done by the next shift");
  });
  it("says when a site hasn't started using checklists", () => {
    const empty = siteWeekReport({ ...input, trackingFrom: undefined, readings: [], signoffs: [], alerts: [], notes: [], prep: [], shifts: [] });
    expect(empty.started).toBe(false);
    expect(empty.rota.hours).toBeNull();
    expect(empty.attention.map((a) => a.level)).toEqual(["info"]);
  });
  it("totals the group and compares weeks", () => {
    const g = groupTotals([r, r], 3);
    expect(g).toMatchObject({ sites: 2, expected: 10, onTime: 4, onTimeRate: 40, openAlerts: 2, hours: 47, people: 3 });
    expect(change(40, 30)).toBe(10);
    expect(change(null, 30)).toBeUndefined();
  });
});

describe("team notices", () => {
  const person = (id: string, name: string, access: Person["access"], status: Person["status"] = "active") =>
    ({ id, name, status, access, staffCode: id, pinFailed: 0 }) as Person;
  const foh = person("f", "Fay", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }]);
  const boh = person("b", "Bo", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }]);
  const mgr = person("m", "Mia", [{ siteId: "EAS", role: "manager", sections: ["FOH"] }]);
  const wem = person("w", "Wes", [{ siteId: "WEM", role: "staff", sections: ["PROD"] }]);
  const left = person("l", "Lee", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }], "left");
  const n = (over: Partial<TeamNotice> = {}): TeamNotice => ({ id: "n1", siteId: "EAS", sections: [], title: "New menu", body: "From Monday", important: false,
    createdBy: "m", createdByName: "Mia", createdAt: 1, reads: [], ...over });
  const SITES = [{ id: "EAS" }, { id: "WEM", brand: "phoco" as const }, { id: "CLV", brand: "clv" as const }];
  const clv = person("c", "Cal", [{ siteId: "CLV", role: "manager", sections: ["FOH", "BOH"] }]);
  const both = person("a", "Ari", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }, { siteId: "CLV", role: "staff", sections: ["BOH"] }]);
  it("is for the right people", () => {
    expect([foh, boh, mgr, wem, left].map((p) => inAudience(n(), p, SITES))).toEqual([true, true, true, false, false]);
    expect([foh, boh, mgr, wem].map((p) => inAudience(n({ sections: ["BOH"] }), p, SITES))).toEqual([false, true, true, false]); // managers always see their site
    expect([foh, wem].map((p) => inAudience(n({ siteId: undefined, brand: "phoco" }), p, SITES))).toEqual([true, true]);
  });
  it("keeps each business's all-sites notices to its own sites", () => {
    const pho = n({ siteId: undefined, brand: "phoco" }), cafe = n({ siteId: undefined, brand: "clv" });
    expect([foh, wem, clv, both].map((p) => inAudience(pho, p, SITES))).toEqual([true, true, false, true]);
    expect([foh, wem, clv, both].map((p) => inAudience(cafe, p, SITES))).toEqual([false, false, true, true]);
    expect(inAudience(n({ siteId: undefined }), clv, SITES)).toBe(false); // an old all-sites notice was PHO & CO's
    expect(inAudience(n({ siteId: "EAS" }), clv, SITES)).toBe(false);
  });
  it("shows until taken down or its last day passes", () => {
    expect(isLive(n(), "2026-10-12")).toBe(true);
    expect(isLive(n({ showUntil: "2026-10-12" }), "2026-10-12")).toBe(true);
    expect(isLive(n({ showUntil: "2026-10-11" }), "2026-10-12")).toBe(false);
    expect(isLive(n({ endedAt: 5 }), "2026-10-12")).toBe(false);
  });
  it("lists unread notices, important first, until 'Got it'", () => {
    const list = [n({ id: "a", createdAt: 1 }), n({ id: "b", createdAt: 2 }), n({ id: "c", createdAt: 0, important: true }), n({ id: "d", reads: [{ personId: "f", readAt: 3 }] })];
    expect(unreadFor(list, foh, "2026-10-12", SITES).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("shows who has and hasn't read it", () => {
    const st = readStats(n({ reads: [{ personId: "b", readAt: 9 }] }), [foh, boh, mgr, wem, left], SITES);
    expect(st.audience).toBe(3);
    expect(st.read.map((r) => r.name)).toEqual(["Bo"]);
    expect(st.unread.map((r) => r.name)).toEqual(["Fay", "Mia"]);
  });
  it("lets managers post to their own sites only", () => {
    expect(canPostTo(["EAS"], SITES, { siteId: "EAS" })).toBe(true);
    expect(canPostTo(["EAS"], SITES, { siteId: "WEM" })).toBe(false);
    expect(canPostTo(["EAS"], SITES, { brand: "phoco" })).toBe(false);
    expect(canPostTo(["EAS", "WEM"], SITES, { brand: "phoco" })).toBe(true);
    expect(canPostTo(["EAS", "WEM"], SITES, { brand: "clv" })).toBe(false);
    expect(canPostTo(["CLV"], SITES, { brand: "clv" })).toBe(true);
    expect(audienceLabel(n({ sections: ["BOH"] }), "Eastcote")).toBe("BOH at Eastcote");
    expect(audienceLabel(n({ siteId: undefined, brand: "phoco" }), undefined)).toBe("Everyone at all PHO & CO sites");
    expect(audienceLabel(n({ siteId: undefined, brand: "clv" }), undefined)).toBe("Everyone at all Cafe La Viet sites");
  });
});

describe("time off", () => {
  const today = "2026-10-12";
  const t = (over: Partial<TimeOff> = {}): TimeOff => ({ id: "t", personId: "p", personName: "Anthony", siteId: "EAS", startsOn: "2026-10-20", endsOn: "2026-10-22",
    kind: "holiday", status: "pending", createdAt: 1, ...over });
  it("checks the dates", () => {
    expect(validateRequest({ startsOn: "2026-10-20", endsOn: "2026-10-22" }, today, [])).toEqual({ ok: true });
    expect(validateRequest({ startsOn: "2026-10-22", endsOn: "2026-10-20" }, today, [])).toMatchObject({ ok: false, error: "The last day is before the first day" });
    expect(validateRequest({ startsOn: "2026-10-11", endsOn: "2026-10-12" }, today, [])).toMatchObject({ ok: false });
    expect(validateRequest({ startsOn: "2026-11-01", endsOn: "2026-12-15" }, today, [])).toMatchObject({ ok: false, error: "Ask for at most 31 days at a time" });
    expect(validateRequest({ startsOn: "", endsOn: "" }, today, [])).toMatchObject({ ok: false });
  });
  it("won't double-book days already asked for, unless that request was declined or withdrawn", () => {
    expect(validateRequest({ startsOn: "2026-10-22", endsOn: "2026-10-23" }, today, [t()])).toMatchObject({ ok: false, error: "You've already asked for Tue 20 Oct to Thu 22 Oct" });
    expect(validateRequest({ startsOn: "2026-10-22", endsOn: "2026-10-23" }, today, [t({ status: "declined" })])).toEqual({ ok: true });
  });
  it("lets a manager of the site decide, but not their own request", () => {
    const mgr = { id: "m", access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] };
    const owner = { id: "o", access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }] };
    const staff = { access: [{ siteId: "EAS" as const, role: "staff" as const, sections: [] }] };
    expect(canDecide(mgr, t(), staff)).toEqual({ ok: true });
    expect(canDecide(mgr, t({ siteId: "WEM" }), staff)).toMatchObject({ ok: false });
    expect(canDecide(mgr, t({ personId: "m" }), mgr)).toMatchObject({ ok: false, error: "Another manager needs to decide your own request" });
    expect(canDecide(owner, t({ personId: "o" }), owner)).toEqual({ ok: true });
    expect(canDecide(mgr, t({ status: "approved" }), staff)).toMatchObject({ ok: false });
  });
  it("can be withdrawn while waiting, or before approved time off starts", () => {
    expect(canCancel(t(), today)).toBe(true);
    expect(canCancel(t({ status: "approved" }), today)).toBe(true);
    expect(canCancel(t({ status: "approved", startsOn: today }), today)).toBe(false);
    expect(canCancel(t({ status: "declined" }), today)).toBe(false);
  });
  it("finds rota clashes and who's off on a day", () => {
    const shifts = [{ date: "2026-10-19" }, { date: "2026-10-21" }, { date: "2026-10-20" }];
    expect(clashes(t(), shifts).map((s) => s.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(daysOf(t())).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(offOn([t({ status: "approved" }), t({ id: "x" })], "2026-10-21").map((x) => x.id)).toEqual(["t"]);
    expect(rangeLabel(t())).toBe("Tue 20 Oct to Thu 22 Oct (3 days)");
    expect(rangeLabel(t({ endsOn: "2026-10-20" }))).toBe("Tue 20 Oct");
  });
});

describe("staff certificates", () => {
  const today = "2026-10-12";
  const c = (over: Partial<Certificate>): Certificate => ({ id: "c", personId: "p", kind: "food_hygiene_l2", createdBy: "o", createdAt: 1, ...over });
  it("works out valid, running out, expired and missing", () => {
    expect(certStatus([c({ expiresOn: "2027-01-01" })], "food_hygiene_l2", true, today).status).toBe("valid");
    expect(certStatus([c({ expiresOn: "2026-11-05" })], "food_hygiene_l2", true, today).status).toBe("expiring");
    expect(certStatus([c({ expiresOn: "2026-10-11" })], "food_hygiene_l2", true, today).status).toBe("expired");
    expect(certStatus([], "food_hygiene_l2", true, today).status).toBe("missing");
    expect(certStatus([], "first_aid", false, today).status).toBe("none");
    expect(certStatus([c({ kind: "right_to_work" })], "right_to_work", true, today).status).toBe("valid"); // no expiry
    // a renewal counts over the old one
    expect(certStatus([c({ expiresOn: "2026-10-01" }), c({ id: "n", expiresOn: "2029-10-01" })], "food_hygiene_l2", true, today).cert?.id).toBe("n");
  });
  it("expects hygiene, allergens and right to work from everyone, Level 3 from managers, nothing from owners", () => {
    const staff = { status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["BOH" as const] }] };
    expect(expectedKinds(staff)).toEqual(["food_hygiene_l2", "allergen", "right_to_work"]);
    expect(expectedKinds({ ...staff, access: [{ siteId: "EAS", role: "manager", sections: [] }] })).toContain("food_hygiene_l3");
    expect(expectedKinds({ ...staff, access: [{ siteId: "EAS", role: "owner", sections: [] }] })).toEqual([]);
    expect(expectedKinds({ ...staff, status: "left" })).toEqual([]);
  });
  it("checks each site has a first aider, a Level 3 and a fire marshal", () => {
    const people = [
      { id: "a", name: "Ana", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: [] }] },
      { id: "b", name: "Ben", status: "active" as const, access: [{ siteId: "WEM" as const, role: "staff" as const, sections: [] }] },
    ];
    const cover = siteCover("EAS", people, [c({ personId: "a", kind: "first_aid", expiresOn: "2027-05-01" }), c({ personId: "b", kind: "fire_marshal" })], today);
    expect(cover.find((x) => x.kind === "first_aid")?.holders).toEqual(["Ana"]);
    expect(cover.find((x) => x.kind === "fire_marshal")?.holders).toEqual([]);
  });
  it("suggests an expiry date and sends reminders 30 days, 7 days and on expiry", () => {
    expect(suggestExpiry("first_aid", "2026-10-12")).toBe("2029-10-12");
    expect(suggestExpiry("personal_licence", "2026-10-12")).toBeUndefined();
    expect(reminderDue({ expiresOn: "2026-12-01" }, today)).toBeUndefined();
    expect(reminderDue({ expiresOn: "2026-11-10" }, today)).toBe("30");
    expect(reminderDue({ expiresOn: "2026-10-18" }, today)).toBe("7");
    expect(reminderDue({ expiresOn: "2026-10-11" }, today)).toBe("expired");
    expect(reminderDue({ expiresOn: "2026-10-12" }, today)).toBe("7"); // the expiry date is the last valid day
    expect(reminderDue({ expiresOn: "2026-09-01" }, today)).toBeUndefined(); // long gone: no message when back-filling
  });
  it("words the status for people", () => {
    expect(statusText("allergen", { status: "expiring", cert: { expiresOn: "2026-10-13" } }, today)).toBe("Runs out tomorrow");
    expect(statusText("allergen", { status: "expiring", cert: { expiresOn: "2026-10-22" } }, today)).toBe("Runs out in 10 days");
    expect(statusText("allergen", { status: "expired", cert: { expiresOn: "2026-10-01" } }, today)).toBe("Ran out 1 Oct 2026");
    expect(statusText("right_to_work", { status: "valid", cert: {} }, today)).toBe("Checked");
    expect(statusText("right_to_work", { status: "expiring", cert: { expiresOn: "2026-10-12" } }, today)).toBe("Follow-up check due today");
    expect(statusText("first_aid", { status: "none" }, today)).toBe("Not held");
    expect(dayMonthYear("2029-03-05")).toBe("5 Mar 2029");
    expect(daysBetween("2026-10-12", "2026-11-11")).toBe(30);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // across the clocks going forward
  });
  it("sends reminders to the holder and their managers, once per stage, and stops when renewed", () => {
    const people = [
      { id: "ana", name: "Ana", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["BOH" as const] }] },
      { id: "mgr", name: "Mo", status: "active" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] },
      { id: "wem", name: "Wes", status: "active" as const, access: [{ siteId: "WEM" as const, role: "manager" as const, sections: [] }] },
      { id: "own", name: "Olu", status: "active" as const, seesRightToWork: true, access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }, { siteId: "WEM" as const, role: "owner" as const, sections: [] }] },
      { id: "co", name: "Cam", status: "active" as const, access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }] },
      { id: "old", name: "Gone", status: "left" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] },
    ];
    const msgs = certReminderMessages(people, [c({ id: "h1", personId: "ana", expiresOn: "2026-10-20" })], today);
    expect(msgs.map((m) => m.personId).sort()).toEqual(["ana", "co", "mgr", "own"]); // not the Wembley manager, not someone who has left
    expect(msgs.find((m) => m.personId === "ana")?.title).toBe("Your Food hygiene Level 2 runs out in 8 days");
    expect(msgs.find((m) => m.personId === "mgr")?.title).toBe("Ana: Food hygiene Level 2 runs out in 8 days");
    expect(msgs.find((m) => m.personId === "mgr")?.url).toBe("/manage/certificates/ana"); // tapping opens their record
    expect(msgs.find((m) => m.personId === "ana")?.url).toBe("/me");
    expect(new Set(msgs.map((m) => m.dedupeKey)).size).toBe(4);
    expect(msgs[0].dedupeKey).toMatch(/^cert\|h1\|30\|/); // 8 days out: the 30-day reminder
    // renewed: the old record no longer counts
    expect(certReminderMessages(people, [c({ id: "h1", personId: "ana", expiresOn: "2026-10-20" }), c({ id: "h2", personId: "ana", expiresOn: "2029-10-10" })], today)).toEqual([]);
    // right to work: only the person allowed to see it, not another owner, a manager or the person themself
    const rtw = certReminderMessages(people, [c({ id: "r", personId: "ana", kind: "right_to_work", expiresOn: "2026-11-01" })], today);
    expect(rtw.map((m) => m.personId)).toEqual(["own"]);
    expect(rtw[0].title).toBe("Ana: right to work follow-up due in 20 days");
    // nothing for people who have left
    expect(certReminderMessages([{ ...people[0], status: "left" }, people[1]], [c({ personId: "ana", expiresOn: "2026-10-20" })], today)).toEqual([]);
  });
  it("lets managers update people at their sites, and only the person allowed records right to work", () => {
    const mgr = { id: "m", status: "active" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] };
    const own = { id: "o", status: "active" as const, seesRightToWork: true, access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }] };
    const coOwner = { id: "co", status: "active" as const, access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }] };
    const easStaff = { status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: [] }] };
    const wemStaff = { status: "active" as const, access: [{ siteId: "WEM" as const, role: "staff" as const, sections: [] }] };
    expect(canEditCerts(mgr, easStaff, "food_hygiene_l2").ok).toBe(true);
    expect(canEditCerts(mgr, wemStaff, "food_hygiene_l2").ok).toBe(false);
    expect(canEditCerts(mgr, easStaff, "right_to_work").ok).toBe(false);
    expect(canEditCerts(own, wemStaff, "right_to_work").ok).toBe(true);
    expect(canEditCerts(coOwner, easStaff, "right_to_work").ok).toBe(false); // being an owner isn't enough
    expect(canEditCerts(coOwner, wemStaff, "food_hygiene_l2").ok).toBe(true);
    expect(visibleTypes(canSeeRightToWork(own)).some((t) => t.id === "right_to_work")).toBe(true);
    expect(visibleTypes(canSeeRightToWork(coOwner)).some((t) => t.id === "right_to_work")).toBe(false);
    expect(canSeeRightToWork({ ...own, status: "frozen" })).toBe(false);
    expect(peopleInCare(mgr, [{ ...easStaff, id: "a" }, { ...wemStaff, id: "b" }, { ...easStaff, id: "c", status: "left" as const }]).map((p) => p.id)).toEqual(["a"]);
  });
  it("checks the dates on a new record", () => {
    expect(validateCert({ kind: "first_aid", issuedOn: "2026-10-01", expiresOn: "2029-10-01" }, today).ok).toBe(true);
    expect(validateCert({ kind: "first_aid", issuedOn: "2026-10-13" }, today).ok).toBe(false); // future
    expect(validateCert({ kind: "first_aid", issuedOn: "2026-10-01", expiresOn: "2026-09-01" }, today).ok).toBe(false);
    expect(validateCert({ kind: "first_aid", issuedOn: "", expiresOn: "2029-10-01" }, today).ok).toBe(false);
    expect(validateCert({ kind: "first_aid", issuedOn: "2026-10-01", expiresOn: "2060-01-01" }, today).ok).toBe(false);
  });
  it("keeps the kinds list and the database check in step", () => {
    expect(CERT_TYPES.map((t) => t.id).sort()).toEqual([...CERT_KINDS].sort());
    const sqlText = readFileSync("supabase/migrations/0010_certificates.sql", "utf8");
    for (const k of CERT_KINDS) expect(sqlText).toContain(`'${k}'`);
  });
  it("counts issues for the manager tile", () => {
    const p = { id: "p", name: "P", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: [] }] };
    expect(issueCount([p], [c({ expiresOn: "2027-01-01" })], today, true)).toBe(2);  // allergen + right to work missing
    expect(issueCount([p], [c({ expiresOn: "2027-01-01" })], today, false)).toBe(1); // managers don't see right to work
    expect(issueCount([p], [c({ expiresOn: "2027-01-01" })], today, false, ["EAS"])).toBe(4); // + no first aider, Level 3 or fire marshal
  });
});

describe("equipment and maintenance", () => {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 9, 12, 9); // Mon 12 Oct 2026, 10:00 London
  const ev = (over: Partial<EquipmentEvent>): EquipmentEvent => ({ id: "e", equipmentId: "fr", siteId: "EAS", kind: "fault", severity: "down", body: "Not cooling", createdBy: "p", createdAt: t0, ...over });
  const fridge: Equipment = { id: "fr", siteId: "EAS", name: "Walk-in fridge", kind: "fridge", serviceEveryMonths: 6, createdAt: 0 };
  it("works out open problems, fixes and when it went down", () => {
    const events = [ev({ id: "f1" }), ev({ id: "u1", kind: "update", faultId: "f1", severity: undefined, body: "Engineer booked", createdAt: t0 + H }),
      ev({ id: "f2", severity: "attention", body: "Door seal torn", createdAt: t0 + 2 * H }), ev({ id: "x1", kind: "fixed", faultId: "f2", severity: undefined, body: "New seal", createdAt: t0 + 3 * H })];
    const faults = faultsOf(events);
    expect(faults.map((f) => f.fault.id)).toEqual(["f2", "f1"]); // newest first
    expect(faults.find((f) => f.fault.id === "f1")?.updates.map((u) => u.body)).toEqual(["Engineer booked"]);
    expect(openFaults(events).map((f) => f.fault.id)).toEqual(["f1"]);
    expect(downSince(events)).toBe(t0);
    expect(downSince([ev({ severity: "attention" })])).toBeUndefined(); // needs attention isn't "out of service"
  });
  it("counts hours out of service in a window, open problems up to the end", () => {
    const events = [ev({ id: "f1", createdAt: t0 }), ev({ id: "x", kind: "fixed", faultId: "f1", severity: undefined, createdAt: t0 + 5 * H }), ev({ id: "f2", createdAt: t0 + 10 * H })];
    expect(downHours(events, t0, t0 + 12 * H)).toBe(7); // 5 h fixed + 2 h still open
    expect(downHours(events, t0 + 4 * H, t0 + 6 * H)).toBe(1);
    expect(sinceText(t0, t0 + 30 * 60_000)).toBe("30 min");
    expect(sinceText(t0, t0 + 5 * H)).toBe("5 h");
    expect(sinceText(t0, t0 + 75 * H)).toBe("3 days");
  });
  it("adds months for service dates, keeping to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-08-15", 6)).toBe("2027-02-15");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });
  it("tracks when a service is due", () => {
    const svc = (doneOn: string) => ev({ id: doneOn, kind: "service", severity: undefined, doneOn, body: "Serviced" });
    expect(serviceState(fridge, [], "2026-10-12").status).toBe("unknown");
    expect(serviceState({}, [svc("2026-01-01")], "2026-10-12").status).toBe("none");
    expect(serviceState(fridge, [svc("2026-06-01")], "2026-10-12")).toEqual({ status: "ok", last: "2026-06-01", due: "2026-12-01" });
    expect(serviceState(fridge, [svc("2026-04-20")], "2026-10-12").status).toBe("soon"); // due 20 Oct
    expect(serviceState(fridge, [svc("2026-01-01"), svc("2026-04-01")], "2026-10-12").status).toBe("overdue"); // latest counts: due 1 Oct
  });
  it("checks the register and service dates", () => {
    expect(validateEquipment({ name: "Fryer 2", kind: "cooking" }).ok).toBe(true);
    expect(validateEquipment({ name: " ", kind: "cooking" }).ok).toBe(false);
    expect(validateEquipment({ name: "Fryer", kind: "cooking", serviceEveryMonths: 0 }).ok).toBe(false);
    expect(validateEquipment({ name: "Fryer", kind: "spaceship" as never }).ok).toBe(false);
    expect(validateService("2026-10-12", "2026-10-12").ok).toBe(true);
    expect(validateService("2026-10-13", "2026-10-12").ok).toBe(false);
  });
  it("tells the site's managers about a problem, not the person who reported it or other sites", () => {
    const people = [
      { id: "cook", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: [] }] },
      { id: "mgr", status: "active" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] },
      { id: "wem", status: "active" as const, access: [{ siteId: "WEM" as const, role: "manager" as const, sections: [] }] },
      { id: "own", status: "active" as const, access: [{ siteId: "EAS" as const, role: "owner" as const, sections: [] }] },
    ];
    const m = faultReportedMessages(fridge, { id: "f1", severity: "down", body: "Not cooling" }, "cook", "Cook", people);
    expect(m.map((x) => x.personId)).toEqual(["mgr", "own"]);
    expect(m[0].title).toBe("Not working: Walk-in fridge");
    expect(m[0].url).toBe("/equipment/fr");
    expect(faultReportedMessages(fridge, { id: "f1", severity: "attention", body: "x" }, "mgr", "Mo", people).map((x) => x.personId)).toEqual(["own"]);
    expect(canUseEquipment(people[0], "EAS")).toBe(true);
    expect(canUseEquipment(people[0], "WEM")).toBe(false);
    expect(canUseEquipment({ ...people[0], status: "frozen" }, "EAS")).toBe(false);
  });
  it("reminds managers two weeks before a service and once it's overdue", () => {
    const people = [{ id: "mgr", status: "active" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] }];
    const svc = (doneOn: string) => ev({ id: doneOn, kind: "service", severity: undefined, doneOn, body: "Serviced" });
    const soon = serviceReminderMessages([fridge], [svc("2026-04-20")], people, { EAS: "Eastcote" }, "2026-10-12");
    expect(soon).toHaveLength(1);
    expect(soon[0].title).toBe("Service due in 8 days: Walk-in fridge (Eastcote)");
    expect(soon[0].dedupeKey).toBe("service|fr|2026-10-20|soon|mgr");
    expect(serviceReminderMessages([fridge], [svc("2026-06-01")], people, {}, "2026-10-12")).toEqual([]);
    expect(serviceReminderMessages([{ ...fridge, retiredAt: 1 }], [svc("2026-01-01")], people, {}, "2026-10-12")).toEqual([]);
    expect(serviceReminderMessages([fridge], [svc("2026-01-01")], people, {}, "2026-10-12")[0].dedupeKey).toBe("service|fr|2026-07-01|overdue|mgr");
  });
  it("only sends people back to equipment pages after signing in", () => {
    expect(safeNextPath("/equipment/7c0f1f0e-4b1d-4c43-9d55-3f0a3c1b2d4e")).toBe("/equipment/7c0f1f0e-4b1d-4c43-9d55-3f0a3c1b2d4e");
    expect(safeNextPath("//evil.example.com")).toBeUndefined();
    expect(safeNextPath("https://evil.example.com/equipment/x")).toBeUndefined();
    expect(safeNextPath("/equipment/../owner")).toBeUndefined();
    expect(safeNextPath("/owner")).toBeUndefined();
    expect(safeNextPath(undefined)).toBeUndefined();
  });
  it("keeps the kinds list and the database check in step", () => {
    const sqlText = readFileSync("supabase/migrations/0011_equipment.sql", "utf8");
    for (const k of EQUIPMENT_KINDS) expect(sqlText).toContain(`'${k.id}'`);
    const kinds = readFileSync("supabase/migrations/0012_equipment_messages.sql", "utf8");
    for (const kind of ["published", "changed", "evening", "notice", "leave", "cert", "report", "fault", "service"]) expect(kinds).toContain(`'${kind}'`);
  });
  it("puts equipment problems and downtime in the weekly report", () => {
    const week = "2026-10-05";
    const mon = Date.UTC(2026, 9, 4, 23); // Mon 5 Oct 00:00 London
    const base = { week, now: mon + 8 * 24 * H, trackingFrom: "2026-10-01", readings: [], signoffs: [], alerts: [], notes: [], prep: [], shifts: [] };
    const r = siteWeekReport({ ...base, faults: [
      { equipment: "Fryer 2", severity: "down", createdAt: mon + 24 * H, fixedAt: mon + 30 * H },
      { equipment: "Walk-in fridge", severity: "down", createdAt: mon + 5 * 24 * H },
      { equipment: "Glasswasher", severity: "attention", createdAt: mon - 24 * H },
    ] });
    expect(r.equipment.reported).toBe(2);
    expect(r.equipment.fixed).toBe(1);
    expect(r.equipment.open).toBe(2); // fridge and glasswasher at the end of the week
    expect(r.equipment.downHours).toBe(6 + 48);
    expect(r.attention.some((a) => a.level === "critical" && a.text === "Walk-in fridge not working for 3 days")).toBe(true);
  });
});

describe("Monday report message", () => {
  it("sums each site up in a line and counts what needs attention", () => {
    const week = "2026-10-05";
    const base = { week, now: Date.UTC(2026, 9, 12, 8), readings: [], signoffs: [], alerts: [], notes: [], prep: [], shifts: [] };
    const eas = siteWeekReport({ ...base, trackingFrom: "2026-10-01", alerts: [{ createdAt: Date.UTC(2026, 9, 6, 10), level: "critical" as const }],
      signoffs: [{ date: "2026-10-05", listId: "a", listName: "Opening", area: "FOH" as const, due: "11:00", answered: 5, total: 5, status: "on_time" as const }, { date: "2026-10-06", listId: "a", listName: "Opening", area: "FOH" as const, due: "11:00", answered: 0, total: 5, status: "not_signed" as const }] });
    const wem = siteWeekReport({ ...base });
    const d = weeklyDigest(week, [{ name: "Eastcote", r: eas }, { name: "Wembley", r: wem }]);
    expect(d.title).toBe("Weekly report: Mon 5 Oct to Sun 11 Oct");
    expect(d.body.split("\n")[0]).toBe("Eastcote: 50% of checks on time · 1 alert open");
    expect(d.body.split("\n")[1]).toBe("Wembley: checklists not in use yet");
    expect(d.body).toContain("things to look at.");
  });
});

describe("tasks and the task centre", () => {
  const today = "2026-10-12";
  const staffBoh = { id: "b", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["BOH" as const] }] };
  const staffFoh = { id: "f", status: "active" as const, access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["FOH" as const] }] };
  const mgr = { id: "m", status: "active" as const, access: [{ siteId: "EAS" as const, role: "manager" as const, sections: [] }] };
  const task = (over: Partial<Task>): Task => ({ id: "t", siteId: "EAS", title: "Clean hood", priority: 3, category: "cleaning", status: "open", createdBy: "m", createdByName: "Mo", createdAt: 1, ...over });
  it("checks a new task", () => {
    expect(validateTask({ title: "Clean hood", priority: 3, category: "cleaning" }, today).ok).toBe(true);
    expect(validateTask({ title: " ", priority: 3, category: "cleaning" }, today).ok).toBe(false);
    expect(validateTask({ title: "x", priority: 3, category: "cleaning", dueOn: "2026-10-11" }, today).ok).toBe(false);
    expect(validateTask({ title: "x", priority: 3, category: "cleaning", assigneeId: "b", section: "BOH" }, today).ok).toBe(false);
    expect(validateTask({ title: "x", priority: 5 as never, category: "cleaning" }, today).ok).toBe(false);
  });
  it("shows a task to its person, its section or everyone at the site; managers can tick any", () => {
    expect(isForPerson(task({ section: "BOH" }), staffBoh)).toBe(true);
    expect(isForPerson(task({ section: "BOH" }), staffFoh)).toBe(false);
    expect(isForPerson(task({}), staffFoh)).toBe(true);
    expect(isForPerson(task({ assigneeId: "b" }), staffFoh)).toBe(false);
    expect(isForPerson(task({ siteId: "WEM" }), staffFoh)).toBe(false);
    expect(isForPerson(task({}), { ...staffFoh, status: "frozen" })).toBe(false);
    expect(canComplete(task({ assigneeId: "b" }), mgr)).toBe(true);
    expect(canComplete(task({ assigneeId: "b" }), staffFoh)).toBe(false);
    expect(audienceText(task({ section: "BOH" }), "Eastcote")).toBe("BOH at Eastcote");
    expect(audienceText(task({}), "Eastcote")).toBe("Anyone at Eastcote");
  });
  it("orders by priority, then overdue, then date", () => {
    const list = [task({ id: "a", priority: 3, dueOn: "2026-10-20" }), task({ id: "b", priority: 2 }), task({ id: "c", priority: 3, dueOn: "2026-10-10" }), task({ id: "d", priority: 3, dueOn: "2026-10-13" })];
    expect(list.sort(taskOrder(today)).map((t) => t.id)).toEqual(["b", "c", "d", "a"]);
    expect(dueText("2026-10-10", today)).toEqual({ text: "Overdue since Sat 10 Oct", overdue: true });
    expect(dueText("2026-10-13", today).text).toBe("Due tomorrow");
  });
  it("puts everything open at a site in one list by priority", () => {
    const input: CentreInput = {
      siteId: "EAS", today,
      tasks: [task({ id: "t1", priority: 4, title: "Paint the back door" }), task({ id: "t2", status: "done" })],
      alerts: [{ id: "a1", level: "critical", title: "Fridge 3 at 9°C", detail: "", createdAt: 5 }],
      kit: [{ id: "k1", name: "Walk-in fridge", foodSafety: true, down: true, problems: 1, since: 3, latest: "Not cooling" },
            { id: "k2", name: "Fryer 2", foodSafety: false, down: true, problems: 2, since: 4, latest: "No heat" },
            { id: "k3", name: "Glasswasher", foodSafety: false, down: false, problems: 1, since: 2, latest: "Leaking" }],
      handoverActions: [{ id: "n1", category: "Food safety", body: "Chicken delivery 9°C", createdAt: 1 }, { id: "n2", category: "Stock shortage", body: "Low on rice", createdAt: 1 }],
      prepOutstanding: { urgent: 1, total: 3, since: 1 },
      checklistsOverdue: [{ id: "EAS-BOH-OPEN", name: "BOH opening", due: "11:00" }],
      timeOffPending: 2,
      certificates: { expired: [{ personId: "p", name: "Ana", label: "Allergen awareness" }], expiring: [], missing: 4 },
      services: [{ id: "k1", name: "Walk-in fridge", overdue: true, due: "2026-10-01" }],
    };
    const items = taskCentre(input);
    const p = (key: string) => items.find((i) => i.key === key)?.priority;
    expect(p("alert:a1")).toBe(1);
    expect(p("kit:k1")).toBe(1);   // food-safety kit down
    expect(p("kit:k2")).toBe(2);   // other kit down
    expect(p("kit:k3")).toBe(3);   // needs attention
    expect(p("note:n1")).toBe(2);  // food safety handover action
    expect(p("note:n2")).toBe(3);
    expect(p("prep")).toBe(2);     // an urgent item among them
    expect(p("list:EAS-BOH-OPEN")).toBe(2);
    expect(p("timeoff")).toBe(3);
    expect(p("cert-x:p:Allergen awareness")).toBe(2);
    expect(p("cert-missing")).toBe(4);
    expect(p("svc:k1")).toBe(3);
    expect(p("task:t1")).toBe(4);
    expect(items.some((i) => i.key === "task:t2")).toBe(false); // done tasks drop off
    expect(items.map((i) => i.priority)).toEqual([...items.map((i) => i.priority)].sort());
    expect(items.find((i) => i.key === "kit:k2")?.detail).toBe("No heat (+1 more)");
  });
  it("keeps categories and message kinds in step with the database", () => {
    const sqlText = readFileSync("supabase/migrations/0013_tasks.sql", "utf8");
    for (const c of TASK_CATEGORIES) expect(sqlText).toContain(`'${c.id}'`);
    for (const kind of ["published", "changed", "evening", "notice", "leave", "cert", "report", "fault", "service", "task"]) expect(sqlText).toContain(`'${kind}'`);
  });
});

describe("dates typed into forms and links", () => {
  it("only accepts real calendar dates", () => {
    expect(isIsoDate("2026-10-12")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-09-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("0000-01-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(clampRange("2026-09-31", "2026-10-05", "2026-10-12", 7)).toEqual({ from: "2026-09-29", to: "2026-10-05" }); // bad "from" falls back to 7 days
  });
});

describe("London times that don't exist", () => {
  it("a time in the spring-forward gap becomes the same time an hour later, not earlier", () => {
    const t = londonToUtc("2027-03-28", "01:30");
    expect(new Date(t).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })).toBe("02:30");
    expect(new Date(londonToUtc("2027-03-28", "02:30")).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(new Date(londonToUtc("2027-03-28", "00:30")).toISOString()).toBe("2027-03-28T00:30:00.000Z");
  });
});

describe("adding a site", async () => {
  const { cleanNewSite } = await import("./sites");
  const existing = [{ id: "EAS", name: "Eastcote" }, { id: "WEM", name: "Wembley" }];
  it("takes a short code, a name and a kind", () => {
    expect(cleanNewSite({ id: " gre ", name: " Greenwich ", kind: "restaurant", gasBy: "21:30" }, existing)).toEqual({ ok: true, value: { id: "GRE", name: "Greenwich", kind: "restaurant", gasBy: "21:30" } });
  });
  it("refuses a taken code or name, a bad code, kind or time", () => {
    expect(cleanNewSite({ id: "EAS", name: "New", kind: "restaurant" }, existing).ok).toBe(false);
    expect(cleanNewSite({ id: "NEW", name: "eastcote", kind: "restaurant" }, existing).ok).toBe(false);
    expect(cleanNewSite({ id: "G1", name: "Greenwich", kind: "restaurant" }, existing).ok).toBe(false);
    expect(cleanNewSite({ id: "GREENW", name: "Greenwich", kind: "restaurant" }, existing).ok).toBe(false);
    expect(cleanNewSite({ id: "GRE", name: "Greenwich", kind: "cafe" }, existing).ok).toBe(false);
    expect(cleanNewSite({ id: "GRE", name: "Greenwich", kind: "restaurant", readyBy: "25:00" }, existing).ok).toBe(false);
  });
});
