import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import type { SopBody } from "@/lib/domain/library";

// Runs against the in-memory demo store only (passed in), never a real database.
const body = (purpose: string): SopBody => ({ sections: ["BOH"], purpose, steps: [{ text: "Put the probe in iced water" }, { text: "It should read 0°C, give or take 1°C" }] });

describe("library store: an SOP from draft to its second version", () => {
  it("drafts, sends back, publishes v1, then replaces it with v2 (kept as history)", async () => {
    resetDemo();
    const db = demoStore;
    const { docId, versionId, code } = await db.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "Probe calibration", body: body("Probes read true"), authorId: "DEMO-MGR" });
    expect(code).toBe("SOP-BOH-001");
    expect((await db.createLibraryDoc({ kind: "sop", prefix: "SOP-BOH-", title: "Fryer oil", body: body("x"), authorId: "DEMO-MGR" })).code).toBe("SOP-BOH-002");

    expect(await db.saveLibraryDraft(versionId, { title: "Probe calibration (monthly)", body: body("Probes must read true") })).toBe(true);
    expect(await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR")).toBe(true);
    expect(await db.saveLibraryDraft(versionId, { title: "x", body: body("x") })).toBe(false); // locked while waiting
    expect(await db.moveLibraryVersion(versionId, "send_back", "DEMO-OPS", "Say how often")).toBe(true);
    const v = (await db.libraryVersion(versionId))!;
    expect([v.status, v.reviewNote, v.reviewedByName, v.submittedBy]).toEqual(["draft", "Say how often", "Ops manager (demo)", undefined]);
    expect(await db.moveLibraryVersion(versionId, "submit", "DEMO-MGR")).toBe(true);
    expect((await db.libraryVersion(versionId))!.reviewNote).toBeUndefined();

    expect(await db.publishLibraryVersion(versionId, { approverId: "DEMO-OPS", change: "new", reviewBy: "2027-10-12" })).toBe(1);
    expect(await db.publishLibraryVersion(versionId, { approverId: "DEMO-OPS", change: "new", reviewBy: "2027-10-12" })).toBeUndefined(); // already done
    let d = (await db.libraryDoc(docId))!;
    expect([d.published?.version, d.published?.title, d.published?.approvedByName, d.open]).toEqual([1, "Probe calibration (monthly)", "Ops manager (demo)", undefined]);
    // The author and the approver have read it; nobody else yet.
    expect((await db.libraryAcks({ versionIds: [versionId] })).map((a) => a.personId).sort()).toEqual(["DEMO-MGR", "DEMO-OPS"]);
    expect(await db.ackLibraryVersion(versionId, "DEMO-BOH")).toBe(true);
    expect(await db.ackLibraryVersion(versionId, "DEMO-BOH")).toBe(false); // once

    // A new draft starts from v1; only one at a time.
    const v2 = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
    expect(v2).toBeTruthy();
    expect(await db.startLibraryDraft(docId, "DEMO-OWN")).toBeUndefined();
    expect((await db.libraryVersion(v2))!.body).toEqual(d.published!.body);
    await db.saveLibraryDraft(v2, { title: "Probe calibration (monthly)", body: body("Probes must read true, checked monthly") });
    await db.moveLibraryVersion(v2, "submit", "DEMO-MGR");
    expect(await db.publishLibraryVersion(v2, { approverId: "DEMO-OWN", change: "minor", reviewBy: "2027-10-12" })).toBe(2);
    d = (await db.libraryDoc(docId))!;
    expect(d.published?.id).toBe(v2);
    const history = await db.libraryVersions(docId);
    expect(history.map((x) => [x.version, x.status])).toEqual([[2, "published"], [1, "superseded"]]);
    // v2 needs reading again: the cook's "read" was for v1.
    expect((await db.libraryAcks({ versionIds: [v2], personId: "DEMO-BOH" }))).toEqual([]);
    expect(await db.ackLibraryVersion(versionId, "DEMO-FOH")).toBe(false); // superseded versions can't be confirmed

    // Retired: no new drafts, nothing published; brought back, it's live again.
    expect(await db.retireLibraryDoc(docId, "DEMO-OWN", "Replaced by the probe SOP")).toBe(true);
    expect(await db.startLibraryDraft(docId, "DEMO-MGR")).toBeUndefined();
    expect(await db.reinstateLibraryDoc(docId)).toBe(true);
    expect((await db.libraryDoc(docId))!.retiredAt).toBeUndefined();

    // A discarded draft is kept, marked discarded, and a new one can start.
    const v3 = (await db.startLibraryDraft(docId, "DEMO-MGR"))!;
    expect(await db.moveLibraryVersion(v3, "discard", "DEMO-MGR")).toBe(true);
    expect((await db.libraryVersion(v3))!.status).toBe("discarded");
    expect(await db.startLibraryDraft(docId, "DEMO-MGR")).toBeTruthy();
    resetDemo();
  });
  it("keeps photos and says which exist", async () => {
    resetDemo();
    const id = await demoStore.addMedia({ mime: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2]), width: 10, height: 8, createdBy: "DEMO-MGR" });
    expect((await demoStore.media(id))?.mime).toBe("image/jpeg");
    expect(await demoStore.mediaExisting([id, "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b"])).toEqual(new Set([id]));
    resetDemo();
  });
});
