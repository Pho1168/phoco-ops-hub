import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { queueShiftReminders } from "@/lib/rota-service";
import { forYouAt, pickFor, rotaAround } from "@/lib/handover-service";
import { targetPeriod } from "@/lib/domain/assign";
import { planSubmit } from "@/lib/domain/prep";
import { weekStartOf } from "@/lib/domain/rota";
import { londonToUtc } from "@/lib/domain/time";

// Runs against the in-memory demo store only (passed in), never a real database.
describe("who handover items are for", () => {
  it("a pick keeps who it's for when the handover is sent; anyone can change it; carried on, it stays with them", async () => {
    resetDemo();
    await demoStore.prepEditDraft("EAS", "DEMO-FOH", { itemId: "kp-007", needed: true, assignee: "DEMO-BOH" });
    await demoStore.prepEditDraft("EAS", "DEMO-FOH", { itemId: "kp-018", needed: true, assignee: "DEMO-PRD" }); // works at Wembley only: not given
    const draft = (await demoStore.prepDraft("EAS"))!;
    expect(draft.entries.find((e) => e.itemId === "kp-007")).toMatchObject({ assignedTo: "DEMO-BOH", assignedBy: "DEMO-FOH", assignedToName: "BOH staff (demo)" });
    expect(draft.entries.find((e) => e.itemId === "kp-018")?.assignedTo).toBeUndefined();

    const sent = (await demoStore.prepSubmit("EAS", "DEMO-FOH", planSubmit))!;
    const rice = (await demoStore.prepHandover(sent.handoverId))!.entries.find((e) => e.itemId === "kp-007")!;
    expect(rice.assignedTo).toBe("DEMO-BOH");
    expect(await demoStore.assignHandover({ kind: "prep", id: rice.id }, "EAS", "DEMO-FOH", "DEMO-BOH")).toBe(true);
    expect(await demoStore.assignHandover({ kind: "prep", id: rice.id }, "EAS", "DEMO-FOH", "DEMO-BOH")).toBe(false); // nothing changes
    expect(await demoStore.assignHandover({ kind: "prep", id: rice.id }, "WEM", null, "DEMO-BOH")).toBe(false); // not that site's
    expect(await demoStore.assignHandover({ kind: "prep", id: rice.id }, "EAS", "DEMO-PRD", "DEMO-BOH")).toBe(false); // not someone at the site
    expect((await demoStore.prepOutstanding("EAS")).find((e) => e.id === rice.id)).toMatchObject({ assignedTo: "DEMO-FOH", assignedBy: "DEMO-BOH", assignedByName: "BOH staff (demo)" });

    // Not done before the next handover: it carries on, still for them, with who said so and when.
    await demoStore.prepEditDraft("EAS", "DEMO-BOH", {});
    const next = (await demoStore.prepSubmit("EAS", "DEMO-BOH", planSubmit))!;
    const carried = (await demoStore.prepHandover(next.handoverId))!.entries.find((e) => e.itemId === "kp-007")!;
    expect(carried.carriedFrom).toBe(rice.id);
    expect(carried).toMatchObject({ assignedTo: "DEMO-FOH", assignedBy: "DEMO-BOH", assignedToName: "FOH staff (demo)" });
    // Done: nothing left to give.
    await demoStore.prepSetDone(carried.id, "EAS", "DEMO-BOH", true);
    expect(await demoStore.assignHandover({ kind: "prep", id: carried.id }, "EAS", "DEMO-BOH", "DEMO-MGR")).toBe(false);
    resetDemo();
  });

  it("a waiting item given to someone, then done before the next handover is sent, isn't asked for again", async () => {
    resetDemo();
    await demoStore.prepEditDraft("EAS", "DEMO-MGR", { itemId: "kp-007", needed: true });
    const first = (await demoStore.prepSubmit("EAS", "DEMO-MGR", planSubmit))!;
    const rice = (await demoStore.prepHandover(first.handoverId))!.entries[0];
    // The closer gives it to someone on the review step: that changes the item that's waiting, not the new draft.
    expect(await demoStore.assignHandover({ kind: "prep", id: rice.id }, "EAS", "DEMO-BOH", "DEMO-MGR")).toBe(true);
    await demoStore.prepEditDraft("EAS", "DEMO-MGR", { itemId: "kp-018", needed: true });
    await demoStore.prepSetDone(rice.id, "EAS", "DEMO-FOH", true);
    const sent = (await demoStore.prepSubmit("EAS", "DEMO-MGR", planSubmit))!;
    expect((await demoStore.prepHandover(sent.handoverId))!.entries.map((e) => e.itemId)).toEqual(["kp-018"]);
    expect(sent.plan.stockedCount).toBe(62);
    resetDemo();
  });

  it("only a note that needs doing is for someone, and only until it's done", async () => {
    resetDemo();
    await demoStore.addHandover({ siteId: "EAS", category: "Other", body: "Party of 12 on Friday", needsAction: false, createdBy: "DEMO-MGR", assignedTo: "DEMO-FOH" });
    await demoStore.addHandover({ siteId: "EAS", category: "Equipment", body: "Fridge 3 door not closing", needsAction: true, createdBy: "DEMO-MGR", assignedTo: "DEMO-BOH" });
    const [fridge, party] = await demoStore.handover("EAS");
    expect(party.assignedTo).toBeUndefined();
    expect(await demoStore.assignHandover({ kind: "note", id: party.id }, "EAS", "DEMO-FOH", "DEMO-MGR")).toBe(false);
    expect(fridge).toMatchObject({ assignedTo: "DEMO-BOH", assignedBy: "DEMO-MGR", assignedToName: "BOH staff (demo)" });
    expect(await demoStore.assignHandover({ kind: "note", id: fridge.id }, "EAS", null, "DEMO-FOH")).toBe(true);
    expect((await demoStore.handover("EAS"))[0]).toMatchObject({ assignedBy: "DEMO-FOH" });
    expect((await demoStore.handover("EAS"))[0].assignedTo).toBeUndefined();
    await demoStore.closeHandover(fridge.id, "EAS", "DEMO-FOH");
    expect(await demoStore.assignHandover({ kind: "note", id: fridge.id }, "EAS", "DEMO-BOH", "DEMO-FOH")).toBe(false);
    resetDemo();
  });

  it("the shift reminder and My shifts say what's for you; the pick list puts that shift's people first", async () => {
    resetDemo();
    const day = "2026-11-04", week = weekStartOf(day);
    const sh = (code: string, section: string, start: string, end: string) =>
      ({ sourceKey: `EAS|${week}|${code}|${section}|2`, staffCode: code, section, week, date: day, start, end, endsNextDay: false });
    await demoStore.applyShiftSync("EAS", { added: [sh("DEMO-FOH", "FOH", "11:00", "22:15"), sh("DEMO-BOH", "BOH", "17:00", "22:15")], changed: [], cancelled: [] },
      new Map([["DEMO-FOH", "DEMO-FOH"], ["DEMO-BOH", "DEMO-BOH"]]));
    await demoStore.setWeekStatuses("EAS", new Map([[week, "published"]]));
    await demoStore.addHandover({ siteId: "EAS", category: "Staff note", body: "Private: talk to Sam", needsAction: true, createdBy: "DEMO-MGR", assignedTo: "DEMO-FOH" });
    await demoStore.prepEditDraft("EAS", "DEMO-MGR", { itemId: "kp-007", needed: true, assignee: "DEMO-FOH" });
    await demoStore.prepEditDraft("EAS", "DEMO-MGR", { itemId: "kp-018", needed: true });
    await demoStore.prepSubmit("EAS", "DEMO-MGR", planSubmit);

    const at = (t: string) => londonToUtc(day, t);
    expect(await queueShiftReminders(at("09:00"), demoStore)).toEqual(["DEMO-FOH"]);
    const [m] = (await demoStore.notices("DEMO-FOH", 10)).filter((n) => n.kind === "shift");
    expect(m.body.split("\n").slice(0, 4)).toEqual(["11:00–22:15 · Front of house", "For you: a staff note (on the tablet), Cook rice", "Also waiting from handover:", "• Prep to do: 1: Salad"]);
    expect(m.body).not.toContain("Sam");

    const sites = await demoStore.sites();
    expect(await forYouAt((await demoStore.person("DEMO-FOH"))!, sites, demoStore)).toEqual([{ site: sites[0], items: [
      { kind: "note", text: "A staff note", urgent: false, onTablet: true }, { kind: "prep", text: "Cook rice", urgent: false, onTablet: false },
    ] }]);
    expect(await forYouAt((await demoStore.person("DEMO-BOH"))!, sites, demoStore)).toEqual([]);

    // Written at 09:00 for "next shift": the 11:00 start is this morning's shift. Only the FOH shift is on in the morning.
    const now = at("09:00");
    const rota = await rotaAround("EAS", now, now, demoStore);
    const pick = pickFor(sites[0], targetPeriod("next", now, rota), rota, await demoStore.people(), now);
    expect(pick.map((g) => g.label)).toEqual(["Working this morning", "Everyone else at Eastcote"]);
    expect(pick[0].people).toEqual([{ id: "DEMO-FOH", name: "FOH staff (demo)", times: "11:00–22:15" }]);
    expect(pick[1].people.map((x) => x.id)).not.toContain("DEMO-PRD"); // Wembley only
    expect(pick[1].people.map((x) => x.id)).toContain("DEMO-BOH");
    resetDemo();
  });

  it("something given to someone who's since been frozen goes back to being for anyone in reminders", async () => {
    resetDemo();
    const day = "2026-11-04", week = weekStartOf(day);
    await demoStore.applyShiftSync("EAS", { added: [{ sourceKey: `EAS|${week}|DEMO-FOH|FOH|2`, staffCode: "DEMO-FOH", section: "FOH", week, date: day, start: "11:00", end: "22:15", endsNextDay: false }], changed: [], cancelled: [] },
      new Map([["DEMO-FOH", "DEMO-FOH"]]));
    await demoStore.setWeekStatuses("EAS", new Map([[week, "published"]]));
    await demoStore.addHandover({ siteId: "EAS", category: "Food safety", body: "Chiller at 9°C, check it", needsAction: true, createdBy: "DEMO-MGR", assignedTo: "DEMO-BOH" });
    await demoStore.updatePerson("DEMO-BOH", { status: "frozen" });
    expect(await queueShiftReminders(londonToUtc(day, "09:00"), demoStore)).toEqual(["DEMO-FOH"]);
    const [m] = (await demoStore.notices("DEMO-FOH", 10)).filter((n) => n.kind === "shift");
    expect(m.body).toContain("• Food safety: Chiller at 9°C, check it");
    resetDemo();
  });
});
