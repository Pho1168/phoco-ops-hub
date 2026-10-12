import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import type { SopBody } from "@/lib/domain/library";
import { ALLERGEN_KEYS, type DishBody } from "@/lib/domain/recipes";

// Runs against the in-memory demo store only (passed in), never a real database.
const body = (purpose: string): SopBody => ({ sections: ["BOH"], purpose, steps: [{ text: "Put the probe in iced water" }, { text: "It should read 0°C, give or take 1°C" }] });
const REVIEW = { change: "new" as const, reviewBy: "2027-10-12" };

describe("library store: an SOP from draft to its second version", () => {
  it("drafts, sends back, publishes v1, then replaces it with v2 (kept as history)", async () => {
    resetDemo();
    const db = demoStore;
    const { docId, versionId, code } = await db.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "Probe calibration", body: body("Probes read true"), authorId: "DEMO-MGR" });
    expect(code).toBe("SOP-BOH-001");
    expect((await db.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "Fryer oil", body: body("x"), authorId: "DEMO-MGR" })).code).toBe("SOP-BOH-002");

    // Every change names the revision it was made from; an old one is refused.
    expect(await db.saveLibraryDraft(versionId, 1, { title: "Probe calibration (monthly)", body: body("Probes must read true") }, "DEMO-MGR")).toBe(2);
    expect(await db.saveLibraryDraft(versionId, 1, { title: "Overwrites?", body: body("x") }, "DEMO-MGR")).toBeUndefined();
    expect(await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR", 1)).toBe(false);
    expect(await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR", 2)).toBe(true);
    expect(await db.saveLibraryDraft(versionId, 3, { title: "x", body: body("x") }, "DEMO-MGR")).toBeUndefined(); // locked while waiting
    expect(await db.moveLibraryVersion(versionId, "send_back", "DEMO-OPS", 3, "Say how often")).toBe(true);
    const v = (await db.libraryVersion(versionId))!;
    expect([v.status, v.reviewNote, v.reviewedByName, v.submittedBy, v.rev, v.contributors]).toEqual(["draft", "Say how often", "Ops manager (demo)", undefined, 4, ["DEMO-MGR"]]);
    expect(await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR", 4)).toBe(true);
    expect((await db.libraryVersion(versionId))!.reviewNote).toBeUndefined();

    // Approving what was on screen: an older revision is refused, and so is anyone who wrote or changed it.
    expect(await db.publishLibraryVersion(versionId, 4, { approverId: "DEMO-OPS", ...REVIEW, ownerApproving: false })).toBeUndefined();
    expect(await db.publishLibraryVersion(versionId, 5, { approverId: "DEMO-MGR", ...REVIEW, ownerApproving: false })).toBeUndefined();
    expect(await db.publishLibraryVersion(versionId, 5, { approverId: "DEMO-OPS", ...REVIEW, ownerApproving: false })).toBe(1);
    expect(await db.publishLibraryVersion(versionId, 6, { approverId: "DEMO-OPS", ...REVIEW, ownerApproving: false })).toBeUndefined(); // already done
    let d = (await db.libraryDoc(docId))!;
    expect([d.published?.version, d.published?.title, d.published?.approvedByName, d.open]).toEqual([1, "Probe calibration (monthly)", "Ops manager (demo)", undefined]);
    // The approver has read it; the writer confirms like everyone else.
    expect((await db.libraryAcks({ versionIds: [versionId] })).map((a) => a.personId)).toEqual(["DEMO-OPS"]);
    expect(await db.ackLibraryVersion(versionId, "DEMO-BOH")).toBe(true);
    expect(await db.ackLibraryVersion(versionId, "DEMO-BOH")).toBe(false); // once

    // A new draft starts from v1; only one at a time. Someone else changing it joins its contributors.
    const v2 = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
    expect(v2).toBeTruthy();
    expect(await db.startLibraryDraft(docId, "DEMO-OWN")).toBeUndefined();
    expect((await db.libraryVersion(v2))!.body).toEqual(d.published!.body);
    expect(await db.saveLibraryDraft(v2, 1, { title: "Probe calibration (monthly)", body: body("Probes must read true, checked monthly") }, "DEMO-OPS")).toBe(2);
    expect((await db.libraryVersion(v2))!.contributors).toEqual(["DEMO-MGR", "DEMO-OPS"]);
    await db.moveLibraryVersion(v2, "submit", "DEMO-MGR", 2);
    expect(await db.publishLibraryVersion(v2, 3, { approverId: "DEMO-OPS", change: "minor", reviewBy: "2027-10-12", ownerApproving: false })).toBeUndefined();
    expect(await db.publishLibraryVersion(v2, 3, { approverId: "DEMO-OWN", change: "minor", reviewBy: "2027-10-12", ownerApproving: true })).toBe(2);
    d = (await db.libraryDoc(docId))!;
    expect(d.published?.id).toBe(v2);
    const history = await db.libraryVersions(docId);
    expect(history.map((x) => [x.version, x.status])).toEqual([[2, "published"], [1, "superseded"]]);
    // v2 needs reading again: the cook's "read" was for v1.
    expect((await db.libraryAcks({ versionIds: [v2], personId: "DEMO-BOH" }))).toEqual([]);
    expect(await db.ackLibraryVersion(versionId, "DEMO-FOH")).toBe(false); // superseded versions can't be confirmed

    // Retired: its draft goes with it, no new drafts, nothing published; brought back, it's live again.
    const v3 = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
    expect(await db.retireLibraryDoc(docId, "DEMO-OWN", "Replaced by the probe SOP")).toBe(true);
    expect((await db.libraryVersion(v3))!.status).toBe("discarded");
    expect(await db.startLibraryDraft(docId, "DEMO-MGR")).toBeUndefined();
    expect(await db.reinstateLibraryDoc(docId)).toBe(true);
    expect((await db.libraryDoc(docId))!.retiredAt).toBeUndefined();

    // A discarded draft is kept, marked discarded, and a new one can start.
    const v4 = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
    expect(await db.moveLibraryVersion(v4, "discard", "DEMO-MGR", 1)).toBe(true);
    expect((await db.libraryVersion(v4))!.status).toBe("discarded");
    expect((await db.libraryDoc(docId))!.retiredAt).toBeUndefined(); // it has a published version
    expect(await db.startLibraryDraft(docId, "DEMO-MGR")).toBeTruthy();
    resetDemo();
  });
  it("discarding the first draft of an SOP never published retires the SOP with it", async () => {
    resetDemo();
    const { docId, versionId } = await demoStore.createLibraryDoc({ kind: "sop", prefix: "SOP-FOH-", title: "Till float", body: body("x"), authorId: "DEMO-MGR" });
    expect(await demoStore.moveLibraryVersion(versionId, "discard", "DEMO-MGR", 1)).toBe(true);
    const d = (await demoStore.libraryDoc(docId))!;
    expect([!!d.retiredAt, d.retiredNote, d.open, d.published]).toEqual([true, "Draft discarded before it was published", undefined, undefined]);
    resetDemo();
  });
  it("light lists carry who it's for, not the steps", async () => {
    resetDemo();
    const [full] = await demoStore.libraryDocs("sop");
    const [light] = await demoStore.libraryDocs("sop", { light: true });
    expect(full.published!.body.steps.length).toBeGreaterThan(0);
    expect([light.published!.title, light.published!.body.sections, light.published!.body.steps]).toEqual([full.published!.title, full.published!.body.sections, []]);
    resetDemo();
  });
});

describe("library store: recipes", () => {
  const free = Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, "free" as const]));
  const dish = (allergens: DishBody["allergens"]): DishBody => ({ sections: ["BOH"], category: "Pho", components: [{ qty: 330, unit: "g", name: "Noodles" }],
    steps: [{ text: "Build it" }], allergens, modifications: "", dietary: [] });
  it("a dish's allergen change is dated when it's published, and kept until the next change", async () => {
    resetDemo();
    const db = demoStore;
    const { docId, versionId, code } = await db.createLibraryDoc({ kind: "dish", prefix: "DISH-BOH-", title: "Pho brisket", body: dish(free), authorId: "DEMO-MGR" });
    expect(code).toBe("DISH-BOH-002"); // after the demo dish
    await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR", 1);
    await db.publishLibraryVersion(versionId, 2, { approverId: "DEMO-OPS", ...REVIEW, ownerApproving: false });
    expect((await db.libraryDoc(docId))!.published!.allergensChangedAt).toBeUndefined(); // a first version isn't a change
    const publish = async (allergens: DishBody["allergens"], mode: "changed" | "same") => {
      const v = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
      await db.saveLibraryDraft(v, 1, { title: "Pho brisket", body: dish(allergens) }, "DEMO-MGR");
      await db.moveLibraryVersion(v, "submit", "DEMO-MGR", 2);
      await db.publishLibraryVersion(v, 3, { approverId: "DEMO-OPS", change: "minor", reviewBy: "2027-10-12", ownerApproving: false, allergens: mode });
      return (await db.libraryDoc(docId))!.published!;
    };
    const v2 = await publish({ ...free, sesame: "contains" }, "changed");
    expect(v2.allergensChangedAt).toBe(v2.publishedAt);
    const v3 = await publish({ ...free, sesame: "contains" }, "same");
    expect(v3.allergensChangedAt).toBe(v2.allergensChangedAt);
    // Confirmations carry the document, so one on v2 still counts after v3.
    expect(await db.ackLibraryVersion(v2.id, "DEMO-FOH")).toBe(false); // v2 is superseded now
    expect(await db.ackLibraryVersion(v3.id, "DEMO-FOH")).toBe(true);
    expect((await db.libraryAcks({ docId, personId: "DEMO-FOH" })).map((a) => [a.docId, a.versionId])).toEqual([[docId, v3.id]]);
    // Light lists: who it's for and its category, nothing else.
    const light = (await db.libraryDocs("dish", { light: true })).find((d) => d.id === docId)!;
    expect([light.published!.body.category, light.published!.body.sections, light.published!.body.components, light.published!.allergensChangedAt]).toEqual(["Pho", ["BOH"], [], v2.allergensChangedAt]);
    resetDemo();
  });
  it("demo mode has a prep recipe and a dish linked to it", async () => {
    resetDemo();
    const [prep] = await demoStore.libraryDocs("prep");
    const [dishDoc] = await demoStore.libraryDocs("dish");
    expect([prep.code, prep.published!.body.makes, dishDoc.code, dishDoc.published!.body.components.find((c) => c.prep)?.prep]).toEqual(["PREP-PROD-001", { qty: 60, unit: "L" }, "DISH-BOH-001", prep.id]);
    resetDemo();
  });
});

describe("library store: photos", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
  const CAP = { max: 100, since: 0 };
  it("keeps photos, says which exist and which are erased; erasing empties one for good", async () => {
    resetDemo();
    const id = (await demoStore.addMedia({ bytes: jpeg, width: 10, height: 8, createdBy: "DEMO-MGR" }, CAP))!;
    expect((await demoStore.media(id))).toMatchObject({ mime: "image/jpeg", erased: false });
    expect(await demoStore.mediaStatus([id, "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b"])).toEqual(new Map([[id, { erased: false }]]));
    expect(await demoStore.mediaCountSince("DEMO-MGR", Date.now() - 60_000)).toBe(1);
    expect(await demoStore.eraseMedia(id, "DEMO-OWN")).toBe(true);
    expect(await demoStore.eraseMedia(id, "DEMO-OWN")).toBe(false);
    expect(await demoStore.media(id)).toMatchObject({ erased: true, bytes: new Uint8Array() });
    expect(await demoStore.mediaInfo(id)).toEqual({ mime: "image/jpeg", erased: true });
    resetDemo();
  });
  it("a person can add only so many a day", async () => {
    resetDemo();
    const cap = { max: 2, since: Date.now() - 60_000 };
    const add = () => demoStore.addMedia({ bytes: jpeg, width: 10, height: 8, createdBy: "DEMO-MGR" }, cap);
    expect([!!(await add()), !!(await add()), await add()]).toEqual([true, true, undefined]);
    expect(await demoStore.addMedia({ bytes: jpeg, width: 10, height: 8, createdBy: "DEMO-OPS" }, cap)).toBeTruthy(); // someone else
    resetDemo();
  });
  it("clears away old photos no version uses (a discarded draft doesn't count), and keeps the ones in use", async () => {
    resetDemo();
    const add = async () => (await demoStore.addMedia({ bytes: jpeg, width: 10, height: 8, createdBy: "DEMO-MGR" }, CAP))!;
    const [used, unused, thrown] = [await add(), await add(), await add()];
    const withPhoto = (id: string) => ({ sections: ["BOH" as const], purpose: "p", steps: [{ text: "Look", photo: { id, w: 10, h: 8 } }] });
    await demoStore.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "With a photo", authorId: "DEMO-MGR", body: withPhoto(used) });
    const scrap = await demoStore.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "Scrap", authorId: "DEMO-MGR", body: withPhoto(thrown) });
    await demoStore.moveLibraryVersion(scrap.versionId, "discard", "DEMO-MGR", 1);
    expect(await demoStore.deleteUnusedMedia(Date.now() - 60_000)).toBe(0); // too new to clear
    expect(await demoStore.deleteUnusedMedia(Date.now() + 60_000)).toBe(2);
    expect(Array.from((await demoStore.mediaStatus([used, unused, thrown])).keys())).toEqual([used]);
    resetDemo();
  });
});
