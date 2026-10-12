import { describe, expect, it } from "vitest";
import {
  canApprove, canDiscard, canDraft, canEditDraft, canReinstate, canRetire, canReview, canWithdraw, changeFor, cleanSop, defaultReviewBy, imageKind, libraryToDo,
  mustRead, nextCode, readStats, readsAt, readyForReview, reviewState, sopPrefix, validReviewBy, versionLabel, type LibraryDoc, type LibraryVersion, type SopBody,
} from "./library";
import type { Person, Site, SiteAccess } from "./types";

const person = (id: string, access: SiteAccess[], over: Partial<Person> = {}): Person =>
  ({ id, staffCode: id, name: id, status: "active", pinFailed: 0, access, ...over });
const at = (siteId: SiteAccess["siteId"], role: SiteAccess["role"], sections: SiteAccess["sections"] = []): SiteAccess => ({ siteId, role, sections });

const owner = person("own", [at("EAS", "owner"), at("WEM", "owner")]);
const ops = person("ops", [at("EAS", "ops"), at("WEM", "ops")]);
const mgr = person("mgr", [at("EAS", "manager", ["FOH", "BOH"])]);
const wemMgr = person("wem", [at("WEM", "manager", ["PROD"])]);
const cook = person("cook", [at("EAS", "staff", ["BOH"])]);
const server = person("srv", [at("EAS", "staff", ["FOH"])]);
const prod = person("prd", [at("WEM", "staff", ["PROD"])]);
const left = person("old", [at("EAS", "staff", ["BOH"])], { status: "left" });
const SITES: Site[] = [
  { id: "EAS", name: "Eastcote", kind: "restaurant", status: "open" },
  { id: "WEM", name: "Wembley", kind: "production", status: "open" },
  { id: "SYD", name: "Sydenham", kind: "restaurant", status: "closed" },
];

const version = (over: Partial<LibraryVersion> = {}): LibraryVersion => ({
  id: "v1", docId: "d1", status: "draft", title: "Probe calibration", body: { sections: ["BOH"], purpose: "Probes read true", steps: [{ text: "Ice water" }] },
  authorId: "mgr", authorName: "mgr", createdAt: 1, updatedAt: 1, ...over,
});
const doc = (over: Partial<LibraryDoc> = {}): LibraryDoc => ({ id: "d1", kind: "sop", code: "SOP-BOH-001", createdAt: 1, ...over });

describe("library: who writes and who approves", () => {
  it("managers, operations managers and owners write drafts; staff don't", () => {
    expect([owner, ops, mgr, wemMgr, cook].map(canDraft)).toEqual([true, true, true, true, false]);
    expect(canDraft({ ...mgr, status: "frozen" })).toBe(false);
  });
  it("only owners and operations managers approve", () => {
    expect([owner, ops, mgr, cook].map(canApprove)).toEqual([true, true, false, false]);
  });
  it("nobody approves a version they wrote or sent, except an owner", () => {
    const mine = version({ status: "in_review", authorId: "ops", submittedBy: "ops" });
    expect(canReview(ops, mine)).toMatchObject({ ok: false, error: "You wrote this version, so another approver checks it" });
    expect(canReview(ops, version({ status: "in_review", authorId: "mgr", submittedBy: "ops" }))).toMatchObject({ ok: false });
    expect(canReview(ops, version({ status: "in_review", authorId: "mgr", submittedBy: "mgr" }))).toEqual({ ok: true });
    expect(canReview(owner, version({ status: "in_review", authorId: "own", submittedBy: "own" }))).toEqual({ ok: true });
    expect(canReview(mgr, version({ status: "in_review", authorId: "ops", submittedBy: "ops" }))).toMatchObject({ ok: false, error: "Only the owner or an operations manager can approve" });
    expect(canReview(owner, version({ status: "draft" }))).toMatchObject({ ok: false, error: "It isn't waiting for approval" });
  });
  it("drafts can be edited; a version waiting for approval is taken back first; published ones never change", () => {
    expect(canEditDraft(mgr, version())).toEqual({ ok: true });
    expect(canEditDraft(mgr, version({ status: "in_review" }))).toMatchObject({ ok: false, error: "It's waiting for approval. Take it back to change it" });
    expect(canEditDraft(owner, version({ status: "published" }))).toMatchObject({ ok: false });
    expect(canEditDraft(cook, version())).toMatchObject({ ok: false });
  });
  it("taking back: whoever wrote or sent it, or an approver", () => {
    const sent = version({ status: "in_review", authorId: "mgr", submittedBy: "mgr" });
    expect(canWithdraw(mgr, sent)).toEqual({ ok: true });
    expect(canWithdraw(ops, sent)).toEqual({ ok: true });
    expect(canWithdraw(wemMgr, sent)).toMatchObject({ ok: false });
  });
  it("discarding a draft: whoever started it, or an approver; retiring and bringing back: approvers", () => {
    expect(canDiscard(mgr, version())).toEqual({ ok: true });
    expect(canDiscard(wemMgr, version())).toMatchObject({ ok: false });
    expect(canDiscard(ops, version())).toEqual({ ok: true });
    expect(canRetire(ops, doc())).toEqual({ ok: true });
    expect(canRetire(mgr, doc())).toMatchObject({ ok: false });
    expect(canRetire(ops, doc({ retiredAt: 5 }))).toMatchObject({ ok: false });
    expect(canReinstate(ops, doc({ retiredAt: 5, published: version({ status: "published" }) }))).toEqual({ ok: true });
    expect(canReinstate(ops, doc({ retiredAt: 5 }))).toMatchObject({ ok: false, error: "It was never published" });
  });
});

describe("library: content", () => {
  const input = { title: "  Probe   calibration ", sections: ["BOH", "FOH", "BOH"], purpose: " Probes must read true. \r\n ",
    steps: [{ text: " Fill a cup with ice and a little water " }, { text: "", warning: "" }, { text: "Wait a minute", warning: " Don't touch the cup sides " },
      { text: "", photo: { id: "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", w: 1600, h: 1200 } }] };
  it("cleans a draft: trims, drops empty steps, keeps sections in order", () => {
    const r = cleanSop(input);
    expect(r).toEqual({ ok: true, value: { title: "Probe calibration", body: { sections: ["FOH", "BOH"], purpose: "Probes must read true.", steps: [
      { text: "Fill a cup with ice and a little water" }, { text: "Wait a minute", warning: "Don't touch the cup sides" },
      { text: "", photo: { id: "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", w: 1600, h: 1200 } }] } } });
  });
  it("refuses what's over the limits or broken", () => {
    expect(cleanSop({ ...input, title: " " })).toMatchObject({ ok: false, error: "Give it a title" });
    expect(cleanSop({ ...input, title: "x".repeat(101) })).toMatchObject({ ok: false });
    expect(cleanSop({ ...input, sections: ["BAR"] })).toMatchObject({ ok: false, error: "Unknown section" });
    expect(cleanSop({ ...input, steps: [{ text: "x".repeat(801) }] })).toMatchObject({ ok: false, error: "Step 1 is too long: keep it under 800 characters, or split it" });
    expect(cleanSop({ ...input, steps: Array.from({ length: 41 }, (_, i) => ({ text: `Step ${i}` })) })).toMatchObject({ ok: false, error: "At most 40 steps: split it into two SOPs" });
    expect(cleanSop({ ...input, steps: [{ text: "a", photo: { id: "not-a-uuid", w: 1, h: 1 } }] })).toMatchObject({ ok: false });
  });
  it("is ready for approval with a purpose and words in every step", () => {
    const body = (cleanSop(input) as { ok: true; value: { body: SopBody } }).value.body;
    expect(readyForReview(body)).toMatchObject({ ok: false, error: "Step 3 needs words, not just a photo or warning" });
    expect(readyForReview({ ...body, steps: body.steps.slice(0, 2) })).toEqual({ ok: true });
    expect(readyForReview({ ...body, purpose: "" })).toMatchObject({ ok: false });
    expect(readyForReview({ ...body, steps: [] })).toMatchObject({ ok: false, error: "Add at least one step" });
  });
  it("codes: one per section, GEN for several or everyone, numbered in turn and never reused", () => {
    expect([sopPrefix(["BOH"]), sopPrefix(["PROD"]), sopPrefix([]), sopPrefix(["FOH", "BOH"])]).toEqual(["SOP-BOH-", "SOP-PROD-", "SOP-GEN-", "SOP-GEN-"]);
    expect(nextCode("SOP-BOH-", ["SOP-BOH-001", "SOP-BOH-007", "SOP-FOH-012"])).toBe("SOP-BOH-008");
    expect(nextCode("SOP-FOH-", [])).toBe("SOP-FOH-001");
  });
  it("review dates: 12 months by default, in the future, at most 3 years; flagged a month ahead", () => {
    expect(defaultReviewBy("2026-10-12")).toBe("2027-10-12");
    expect(validReviewBy("2026-10-12", "2026-10-12")).toMatchObject({ ok: false });
    expect(validReviewBy("2029-10-13", "2026-10-12")).toMatchObject({ ok: false });
    expect(validReviewBy("2027-01-01", "2026-10-12")).toEqual({ ok: true });
    expect([reviewState("2026-10-01", "2026-10-12"), reviewState("2026-11-01", "2026-10-12"), reviewState("2027-01-01", "2026-10-12"), reviewState(undefined, "2026-10-12")])
      .toEqual(["overdue", "soon", undefined, undefined]);
  });
  it("the first version is new; after that the approver says minor or major", () => {
    expect(changeFor(false, undefined)).toEqual({ ok: true, value: "new" });
    expect(changeFor(true, "major")).toEqual({ ok: true, value: "major" });
    expect(changeFor(true, undefined)).toMatchObject({ ok: false });
  });
});

describe("library: who reads what", () => {
  it("staff by their sections, managers by the site's sections, nobody at a closed site, owners never", () => {
    const eas = SITES[0], wem = SITES[1], syd = SITES[2];
    expect(readsAt(["BOH"], cook, eas)).toBe(true);
    expect(readsAt(["BOH"], server, eas)).toBe(false);
    expect(readsAt(["FOH"], mgr, eas)).toBe(true);
    expect(readsAt(["PROD"], mgr, eas)).toBe(false); // Eastcote has no production section
    expect(readsAt(["PROD"], ops, wem)).toBe(true);
    expect(readsAt([], prod, wem)).toBe(true); // for everyone
    expect(readsAt([], owner, eas)).toBe(false);
    expect(readsAt([], left, eas)).toBe(false);
    expect(readsAt([], person("s", [at("SYD", "staff", ["FOH"])]), syd)).toBe(false);
  });
  it("must read: published, live, for them and not yet read, newest first", () => {
    const pub = (id: string, sections: SopBody["sections"], publishedAt: number) => version({ id, status: "published", publishedAt, body: { sections, purpose: "p", steps: [{ text: "s" }] } });
    const docs = [
      doc({ id: "a", published: pub("a1", ["BOH"], 10) }),
      doc({ id: "b", published: pub("b2", [], 30) }),
      doc({ id: "c", published: pub("c1", ["FOH"], 20) }),
      doc({ id: "d", published: pub("d1", [], 40), retiredAt: 50 }),
      doc({ id: "e" }), // never published
    ];
    expect(mustRead(cook, docs, new Set(), SITES).map((d) => d.id)).toEqual(["b", "a"]);
    expect(mustRead(cook, docs, new Set(["b2"]), SITES).map((d) => d.id)).toEqual(["a"]);
    expect(mustRead(mgr, docs, new Set(), SITES).map((d) => d.id)).toEqual(["b", "c", "a"]);
    expect(mustRead(owner, docs, new Set(), SITES)).toEqual([]);
  });
  it("read stats per site: who has and hasn't, by name", () => {
    const people = [owner, ops, mgr, wemMgr, cook, server, prod, left];
    const stats = readStats(["BOH"], "v2", people, [{ versionId: "v2", personId: "cook", at: 5 }, { versionId: "v1", personId: "mgr", at: 1 }], SITES);
    expect(stats.map((s) => [s.siteId, s.read.map((p) => p.id), s.unread.map((p) => p.id)])).toEqual([
      ["EAS", ["cook"], ["mgr", "ops"]],
      ["WEM", [], []],
    ]);
  });
});

describe("library: to do and labels", () => {
  it("approvers see versions waiting for them; authors see their drafts sent back", () => {
    const docs = [
      doc({ id: "a", open: version({ status: "in_review", authorId: "mgr", submittedBy: "mgr" }) }),
      doc({ id: "b", open: version({ status: "in_review", authorId: "ops", submittedBy: "ops" }) }),
      doc({ id: "c", open: version({ status: "draft", authorId: "mgr", reviewNote: "Add the ice step" }) }),
      doc({ id: "d", open: version({ status: "in_review", authorId: "mgr", submittedBy: "mgr" }), retiredAt: 3 }),
    ];
    expect(libraryToDo(ops, docs)).toBe(1); // not their own
    expect(libraryToDo(owner, docs)).toBe(2);
    expect(libraryToDo(mgr, docs)).toBe(1); // sent back to them
    expect(libraryToDo(cook, docs)).toBe(0);
    expect([versionLabel({ status: "draft" }), versionLabel({ status: "draft", reviewNote: "x" }), versionLabel({ status: "in_review" })]).toEqual(["Draft", "Sent back", "Waiting for approval"]);
  });
});

describe("library: photos", () => {
  it("knows a photo by its first bytes, not by what the upload says", () => {
    const bytes = (...n: number[]) => new Uint8Array(n);
    expect(imageKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(imageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(imageKind(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageKind(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeUndefined();
    expect(imageKind(bytes())).toBeUndefined();
  });
});
