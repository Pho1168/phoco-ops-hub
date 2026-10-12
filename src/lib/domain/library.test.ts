import { describe, expect, it } from "vitest";
import {
  canApprove, canDiscard, canDraft, canEditDraft, canReinstate, canRetire, canReview, canWithdraw, changeFor, cleanSop, coversReach, defaultReviewBy, docReach, dropPhotos, imageKind,
  isContributor, jpegSize, libraryToDo, mustRead, nextCode, reachedSites, readStats, readsAt, readyForReview, reviewState, sopPrefix, validReviewBy, versionLabel,
  type LibraryDoc, type LibraryVersion, type SopBody,
} from "./library";
import type { Person, Site, SiteAccess } from "./types";

const person = (id: string, access: SiteAccess[], over: Partial<Person> = {}): Person =>
  ({ id, staffCode: id, name: id, status: "active", pinFailed: 0, access, ...over });
const at = (siteId: SiteAccess["siteId"], role: SiteAccess["role"], sections: SiteAccess["sections"] = []): SiteAccess => ({ siteId, role, sections });

const owner = person("own", [at("EAS", "owner"), at("WEM", "owner")]);
const ops = person("ops", [at("EAS", "ops"), at("WEM", "ops")]);
const easOps = person("opsE", [at("EAS", "ops")]); // runs Eastcote only
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
  authorId: "mgr", authorName: "mgr", createdAt: 1, updatedAt: 1, contributors: [], rev: 1, ...over,
});
const ALL = reachedSites([], SITES); // a version for everyone reaches both open sites
const doc = (over: Partial<LibraryDoc> = {}): LibraryDoc => ({ id: "d1", kind: "sop", code: "SOP-BOH-001", createdAt: 1, ...over });

describe("library: who writes and who approves", () => {
  it("managers, operations managers and owners write drafts; staff don't", () => {
    expect([owner, ops, mgr, wemMgr, cook].map(canDraft)).toEqual([true, true, true, true, false]);
    expect(canDraft({ ...mgr, status: "frozen" })).toBe(false);
  });
  it("only owners and operations managers approve", () => {
    expect([owner, ops, mgr, cook].map(canApprove)).toEqual([true, true, false, false]);
  });
  it("nobody approves a version they wrote, changed or sent, except an owner", () => {
    const mine = version({ status: "in_review", authorId: "ops", submittedBy: "ops", contributors: ["ops"] });
    expect(canReview(ops, mine, ALL)).toMatchObject({ ok: false, error: "You wrote or changed this version, so another approver checks it" });
    expect(canReview(ops, version({ status: "in_review", authorId: "mgr", submittedBy: "ops" }), ALL)).toMatchObject({ ok: false });
    // Changed it along the way (saved the draft), even if someone else wrote and sent it.
    expect(canReview(ops, version({ status: "in_review", authorId: "mgr", submittedBy: "mgr", contributors: ["mgr", "ops"] }), ALL)).toMatchObject({ ok: false });
    expect(canReview(ops, version({ status: "in_review", authorId: "mgr", submittedBy: "mgr", contributors: ["mgr"] }), ALL)).toEqual({ ok: true });
    expect(canReview(owner, version({ status: "in_review", authorId: "own", submittedBy: "own", contributors: ["own"] }), ALL)).toEqual({ ok: true });
    expect(canReview(mgr, version({ status: "in_review", authorId: "ops", submittedBy: "ops" }), ALL)).toMatchObject({ ok: false, error: "Only the owner or an operations manager can approve" });
    expect(canReview(owner, version({ status: "draft" }), ALL)).toMatchObject({ ok: false, error: "It isn't waiting for approval" });
    expect([isContributor(ops, version({ contributors: ["ops"] })), isContributor(ops, version({ submittedBy: "ops" })), isContributor(ops, version())]).toEqual([true, true, false]);
  });
  it("an operations manager approves only what reaches sites they run; the owner approves the rest", () => {
    expect(reachedSites(["BOH"], SITES)).toEqual(["EAS"]);
    expect(reachedSites(["PROD"], SITES)).toEqual(["WEM"]);
    expect(reachedSites([], SITES)).toEqual(["EAS", "WEM"]); // Sydenham is closed
    const sent = (sections: SopBody["sections"]) => version({ status: "in_review", body: { sections, purpose: "p", steps: [{ text: "s" }] } });
    expect(canReview(easOps, sent(["BOH"]), reachedSites(["BOH"], SITES))).toEqual({ ok: true });
    expect(canReview(easOps, sent(["PROD"]), reachedSites(["PROD"], SITES))).toMatchObject({ ok: false, error: "It covers a site you don't run, so the owner approves it" });
    expect(canReview(easOps, sent([]), ALL)).toMatchObject({ ok: false });
    expect(canReview(ops, sent([]), ALL)).toEqual({ ok: true });
    expect(canReview(owner, sent(["PROD"]), reachedSites(["PROD"], SITES))).toEqual({ ok: true });
    expect([coversReach(owner, ALL), coversReach(ops, ALL), coversReach(easOps, ["EAS"]), coversReach(easOps, ALL), coversReach(mgr, [])]).toEqual([true, true, true, false, false]);
  });
  it("narrowing who an SOP is for still counts the sites it would be taken from", () => {
    const body = (sections: SopBody["sections"]) => ({ sections, purpose: "p", steps: [{ text: "s" }] });
    // A production SOP (Wembley) re-scoped to Back of house (Eastcote): it covers both until published.
    const rescoped = doc({ published: version({ status: "published", body: body(["PROD"]) }), open: version({ status: "in_review", body: body(["BOH"]) }) });
    expect(docReach(rescoped, SITES)).toEqual(["WEM", "EAS"]);
    expect(canReview(easOps, rescoped.open!, docReach(rescoped, SITES))).toMatchObject({ ok: false });
    expect(docReach(doc({ open: version({ body: body(["BOH"]) }) }), SITES)).toEqual(["EAS"]);
    expect(docReach(doc(), SITES)).toEqual([]);
  });
  it("drafts can be edited; a version waiting for approval is taken back first; published ones never change", () => {
    expect(canEditDraft(mgr, version())).toEqual({ ok: true });
    expect(canEditDraft(mgr, version({ status: "in_review" }))).toMatchObject({ ok: false, error: "It's waiting for approval. Take it back to change it" });
    expect(canEditDraft(owner, version({ status: "published" }))).toMatchObject({ ok: false });
    expect(canEditDraft(cook, version())).toMatchObject({ ok: false });
  });
  it("taking back: whoever wrote or sent it (if they still write SOPs), or an approver for its sites", () => {
    const sent = version({ status: "in_review", authorId: "mgr", submittedBy: "mgr" });
    const EAS = ["EAS" as const], WEM = ["WEM" as const];
    expect(canWithdraw(mgr, sent, EAS)).toEqual({ ok: true });
    expect(canWithdraw(ops, sent, EAS)).toEqual({ ok: true });
    expect(canWithdraw(wemMgr, sent, EAS)).toMatchObject({ ok: false });
    expect(canWithdraw({ ...mgr, access: [at("EAS", "staff", ["BOH"])] }, sent, EAS)).toMatchObject({ ok: false }); // no longer a manager
    expect(canWithdraw(easOps, sent, WEM)).toMatchObject({ ok: false, error: "Only whoever sent it, or an approver for its sites, can take it back" });
    expect(canWithdraw(easOps, version({ status: "in_review", authorId: "opsE" }), WEM)).toEqual({ ok: true }); // their own
  });
  it("discarding a draft: whoever started it, or an approver for its sites", () => {
    const EAS = ["EAS" as const], WEM = ["WEM" as const];
    expect(canDiscard(mgr, version(), EAS)).toEqual({ ok: true });
    expect(canDiscard(wemMgr, version(), EAS)).toMatchObject({ ok: false });
    expect(canDiscard(ops, version(), EAS)).toEqual({ ok: true });
    expect(canDiscard(easOps, version(), WEM)).toMatchObject({ ok: false });
    expect(canDiscard({ ...mgr, status: "frozen" }, version(), EAS)).toMatchObject({ ok: false });
  });
  it("retiring a published SOP and bringing it back: approvers for every site it covers", () => {
    const EAS = ["EAS" as const], WEM = ["WEM" as const];
    const live = doc({ published: version({ status: "published" }) });
    expect(canRetire(ops, live, EAS)).toEqual({ ok: true });
    expect(canRetire(mgr, live, EAS)).toMatchObject({ ok: false });
    expect(canRetire(easOps, live, WEM)).toMatchObject({ ok: false, error: "It covers a site you don't run, so the owner retires it" });
    expect(canRetire(owner, live, WEM)).toEqual({ ok: true });
    expect(canRetire(ops, doc({ ...live, retiredAt: 5 }), EAS)).toMatchObject({ ok: false });
    expect(canRetire(ops, doc({ open: version() }), EAS)).toMatchObject({ ok: false, error: "It was never published: discard the draft instead" });
    expect(canReinstate(ops, doc({ retiredAt: 5, published: version({ status: "published" }) }), EAS)).toEqual({ ok: true });
    expect(canReinstate(easOps, doc({ retiredAt: 5, published: version({ status: "published" }) }), WEM)).toMatchObject({ ok: false });
    expect(canReinstate(ops, doc({ retiredAt: 5 }), EAS)).toMatchObject({ ok: false, error: "It was never published" });
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
    expect(cleanSop({ ...input, steps: Array.from({ length: 41 }, (_, i) => ({ text: `Step ${i}` })) })).toMatchObject({ ok: false, error: "At most 40 steps: split it into two" });
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
    expect(libraryToDo(ops, docs, SITES)).toBe(1); // not their own
    expect(libraryToDo(owner, docs, SITES)).toBe(2);
    expect(libraryToDo(mgr, docs, SITES)).toBe(1); // sent back to them
    expect(libraryToDo(cook, docs, SITES)).toBe(0);
    // An Eastcote-only operations manager isn't asked about a production SOP: the owner is.
    const prodDoc = doc({ id: "p", open: version({ status: "in_review", body: { sections: ["PROD"], purpose: "p", steps: [{ text: "s" }] } }) });
    expect([libraryToDo(easOps, [prodDoc], SITES), libraryToDo(owner, [prodDoc], SITES)]).toEqual([0, 1]);
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
  it("reads a JPEG's real width and height from its frame header", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    const sof = (w: number, h: number, marker = 0xc0) => [0xff, marker, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);
    expect(jpegSize(jpeg(app0, sof(1600, 1200)))).toEqual({ w: 1600, h: 1200 });
    expect(jpegSize(jpeg(app0, sof(900, 1600, 0xc2)))).toEqual({ w: 900, h: 1600 }); // progressive
    expect(jpegSize(jpeg(app0, [0xff, 0xda, 0x00, 0x02]))).toBeUndefined(); // image data before any size
    expect(jpegSize(jpeg(app0, sof(0, 10)))).toBeUndefined();
    expect(jpegSize(jpeg(app0).subarray(0, 10))).toBeUndefined(); // cut short
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBeUndefined(); // a PNG
  });
  it("an erased photo leaves its step's words; a step that was only that photo goes", () => {
    const A = "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", B = "9f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", C = "af0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b";
    const ph = (id: string) => ({ id, w: 10, h: 10 });
    const body: SopBody = { sections: ["BOH"], purpose: "p", steps: [{ text: "a", photo: ph(A) }, { text: "", photo: ph(B) }, { text: "", warning: "w", photo: ph(A) }, { text: "c", photo: ph(C) }] };
    expect(dropPhotos(body, new Set([A, B]))).toEqual({ sections: ["BOH"], purpose: "p", steps: [{ text: "a" }, { text: "", warning: "w" }, { text: "c", photo: ph(C) }] });
    expect(dropPhotos(body, new Set())).toEqual(body);
  });
});
