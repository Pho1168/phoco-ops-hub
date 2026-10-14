import { describe, expect, it } from "vitest";
import { canEditChecklists, canPublish, cleanItems, cleanSettings, describeChange, templateId, toDraftItems, type DraftItem } from "./checklist-edit";
import type { ChecklistItem, Person, TempRule } from "./types";

const RULES: Record<string, TempRule> = { F: { code: "F", label: "Fridge", targetMax: 5, legalMax: 8 }, C: { code: "C", label: "Cooked", targetMin: 75 } };
const person = (role: Person["access"][number]["role"]): Pick<Person, "access"> => ({ access: [{ siteId: "EAS", role, sections: [] }] });

describe("who edits checklists", () => {
  it("is the owner only", () => {
    expect(canEditChecklists(person("owner"))).toBe(true);
    expect(canEditChecklists(person("ops"))).toBe(false);
    expect(canEditChecklists(person("manager"))).toBe(false);
    expect(canEditChecklists(person("staff"))).toBe(false);
  });
});

describe("cleanSettings", () => {
  it("accepts a name, area, when and an HH:MM due time", () => {
    const r = cleanSettings({ name: "  FOH   Opening ", area: "FOH", when: "Before doors open", due: "11:45" });
    expect(r).toEqual({ ok: true, value: { name: "FOH Opening", area: "FOH", when: "Before doors open", due: "11:45" } });
  });
  it("lets the due time be empty (never late)", () => {
    const r = cleanSettings({ name: "Toilet check", area: "FOH", when: "Every 2 hours", due: "" });
    expect(r.ok && r.value.due).toBeUndefined();
  });
  it("refuses a bad time, a missing name, an unknown area", () => {
    expect(cleanSettings({ name: "X", area: "FOH", when: "Before", due: "11:45" }).ok).toBe(false);
    expect(cleanSettings({ name: "Opening", area: "BAR", when: "Before", due: "" }).ok).toBe(false);
    expect(cleanSettings({ name: "Opening", area: "FOH", when: "", due: "" }).ok).toBe(false);
    expect(cleanSettings({ name: "Opening", area: "FOH", when: "Before", due: "25:00" }).ok).toBe(false);
    expect(cleanSettings({ name: "Opening", area: "FOH", when: "Before", due: "9am" }).ok).toBe(false);
  });
});

describe("templateId", () => {
  it("is SITE-AREA-SLUG like the seeded ids", () => {
    expect(templateId("EAS", "FOH", "Bar & Counter Prep", [])).toBe("EAS-FOH-BAR-COUNTER-PREP");
  });
  it("adds a number when the id is taken", () => {
    expect(templateId("EAS", "BOH", "Opening", ["EAS-BOH-OPENING"])).toBe("EAS-BOH-OPENING-2");
    expect(templateId("EAS", "BOH", "Opening", ["eas-boh-opening", "EAS-BOH-OPENING-2"])).toBe("EAS-BOH-OPENING-3");
  });
  it("copes with a name that leaves no letters", () => {
    expect(templateId("WEM", "PROD", "---", [])).toBe("WEM-PROD-LIST");
  });
});

describe("cleanItems", () => {
  it("renumbers, trims, carries the section down and drops empty rows", () => {
    const r = cleanItems([
      { section: "Fridges", text: " Walk-in  fridge ", type: "temp", ruleCode: "F" },
      { section: "", text: "Freezer", type: "temp", ruleCode: "F", hint: " -18 or below " },
      { section: "", text: "", type: "tick" },
      { section: "Floor", text: "Mopped", type: "tick", ruleCode: "F" },
    ], RULES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      { section: "Fridges", text: "Walk-in fridge", type: "temp", ruleCode: "F", hint: undefined },
      { section: "Fridges", text: "Freezer", type: "temp", ruleCode: "F", hint: "-18 or below" },
      { section: "Floor", text: "Mopped", type: "tick", ruleCode: undefined, hint: undefined },
    ]);
  });
  it("needs a limit on every temperature check", () => {
    const r = cleanItems([{ section: "Fridges", text: "Walk-in", type: "temp" }], RULES);
    expect(r.ok).toBe(false);
    const bad = cleanItems([{ section: "Fridges", text: "Walk-in", type: "temp", ruleCode: "Q" }], RULES);
    expect(bad.ok).toBe(false);
  });
  it("refuses no checks, an unknown type and a hint with no check", () => {
    expect(cleanItems([], RULES).ok).toBe(false);
    expect(cleanItems([{ section: "", text: "", type: "tick", hint: "orphan" }], RULES).ok).toBe(false);
    expect(cleanItems([{ section: "A", text: "Thing", type: "video" }], RULES).ok).toBe(false);
    expect(cleanItems("nope", RULES).ok).toBe(false);
  });
});

describe("describeChange", () => {
  const a: DraftItem[] = [{ section: "A", text: "One", type: "tick" }, { section: "A", text: "Two", type: "tick" }];
  it("counts what a version adds and removes", () => {
    expect(describeChange(undefined, a)).toBe("2 checks");
    expect(describeChange(a, [...a, { section: "A", text: "Three", type: "tick" }])).toBe("3 checks: 1 added");
    expect(describeChange(a, [a[1]])).toBe("1 check: 1 removed");
    expect(describeChange(a, [a[1], a[0]])).toBe("2 checks: reordered");
    expect(describeChange(a, a)).toBe("2 checks, unchanged");
  });
  it("starts the editor from the published items in order", () => {
    const items: ChecklistItem[] = [{ id: "b", position: 2, section: "A", text: "Two", type: "tick" }, { id: "a", position: 1, section: "A", text: "One", type: "tick", hint: "h" }];
    expect(toDraftItems(items)).toEqual([{ section: "A", text: "One", type: "tick", ruleCode: undefined, hint: "h" }, { section: "A", text: "Two", type: "tick", ruleCode: undefined, hint: undefined }]);
  });
});

describe("canPublish", () => {
  const items: DraftItem[] = [{ section: "A", text: "One", type: "tick" }];
  it("waits while today's run is half done, since its answers belong to the old version", () => {
    expect(canPublish(items, { answers: 3, signed: false }).ok).toBe(false);
  });
  it("goes ahead when today's run is signed, not started, or there is none", () => {
    expect(canPublish(items, { answers: 3, signed: true }).ok).toBe(true);
    expect(canPublish(items, { answers: 0, signed: false }).ok).toBe(true);
    expect(canPublish(items, undefined).ok).toBe(true);
  });
  it("needs at least one check", () => {
    expect(canPublish([], undefined).ok).toBe(false);
  });
});
