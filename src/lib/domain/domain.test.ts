import { describe, expect, it } from "vitest";
import { classifyReading, parseReading } from "./temperature";
import { canSignOff, evaluateAnswer, progress, runState } from "./checklist";
import { canFreeze, canSignIn, isPinLocked, planSiteClosure, registerPinFailure, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from "./access";
import { diffShifts, parseExport, reminderTimes } from "./rota";
import { hashPin, isValidPin, verifyPin } from "./pin";
import { canUseDeviceForSite, formatPairCode, makePairCode, normalizePairCode, sessionDeviceOk, PAIR_ALPHABET, type Device } from "./devices";
import { canChangeAccess, canMarkLeft, nextStaffCode, validatePersonInput } from "./staff";
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
  const row = (name: string, section: string, days: Record<number, [string, string]>, checks = "0") => {
    const r = ["05/10/2026", "1", "1", "8", name, section, "", "", "", "", "", "", "", "", checks];
    for (let d = 0; d < 7; d++) r.push(...(days[d] ?? ["", ""]));
    return r;
  };
  const staff = [{ name: "Alex", section: "FOH", staffCode: "PC-9001" }, { name: "Alex", section: "BOH", staffCode: "PC-9001" }];

  it("turns Export rows into dated shifts and flags problems", () => {
    const { shifts, issues } = parseExport("EAS", [
      header,
      row("Alex", "FOH", { 1: ["11:00", "21:45"], 4: ["17:00", "21:00"] }),
      row("Alex", "BOH", { 3: ["11:00", "21:30"] }),
      row("Sam", "BOH", { 0: ["11:00", "15:00"] }),
      row("Alex", "FOH", { 0: ["25:00", "22:00"] }),
      row("Alex", "FOH", { 2: ["11:00", "22:00"] }, "1"),
      row("", "", {}),
    ], staff);
    expect(shifts.map((s) => `${s.section} ${s.date} ${s.start}-${s.end}`)).toEqual([
      "FOH 2026-10-06 11:00-21:45", "FOH 2026-10-09 17:00-21:00", "BOH 2026-10-08 11:00-21:30",
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "Sam (BOH) has no Staff ID in the Staff tab",
      'Alex: day 1 times "25:00–22:00" are not valid',
      "Alex: the sheet flags this row (Checks). Not imported",
    ]);
  });
  it("only published weeks get reminders, and quiet hours are respected", () => {
    const s = { sourceKey: "k", staffCode: "PC-9001", section: "FOH", date: "2026-10-09", start: "11:00", end: "22:15", endsNextDay: false };
    expect(reminderTimes(s, false)).toEqual([]);
    expect(reminderTimes(s, true)).toEqual([
      { date: "2026-10-08", time: "18:00", kind: "evening" },
      { date: "2026-10-09", time: "09:00", kind: "before" },
    ]);
    const early = { ...s, start: "08:00" };
    expect(reminderTimes(early, true).map((r) => r.kind)).toEqual(["evening"]);
  });
  it("detects changed and cancelled shifts between imports", () => {
    const a = { sourceKey: "1", staffCode: "x", section: "FOH", date: "2026-10-09", start: "11:00", end: "22:00", endsNextDay: false };
    const b = { ...a, sourceKey: "2" };
    const d = diffShifts([a, b], [{ ...a, start: "12:00" }]);
    expect(d.changed).toHaveLength(1);
    expect(d.cancelled.map((s) => s.sourceKey)).toEqual(["2"]);
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
  const cook = { ...person("cook", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }]), staffCode: "PC-0003" };

  it("cleans input and keeps only sections that exist at each site", () => {
    const r = validatePersonInput({ name: "  Mai  Tran ", staffCode: "pc-0009", access: [
      { siteId: "EAS", role: "staff", sections: ["FOH", "PROD"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }] }, SITES, [owner, cook]);
    expect(r).toEqual({ ok: true, value: { name: "Mai Tran", staffCode: "PC-0009", access: [
      { siteId: "EAS", role: "staff", sections: ["FOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }] } });
  });
  it("rejects a taken staff ID, a bad ID, no sites and no sections", () => {
    const base = { name: "X", staffCode: "PC-0003", access: [{ siteId: "EAS" as const, role: "staff" as const, sections: ["FOH" as const] }] };
    expect(validatePersonInput(base, SITES, [cook]).ok).toBe(false);
    expect(validatePersonInput(base, SITES, [cook], "cook").ok).toBe(true);
    expect(validatePersonInput({ ...base, staffCode: "123" }, SITES, []).ok).toBe(false);
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
  it("suggests the next staff ID", () => {
    expect(nextStaffCode([cook, { ...owner, staffCode: "PC-0000" }])).toBe("PC-0004");
    expect(nextStaffCode([])).toBe("PC-0001");
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
  });
});
