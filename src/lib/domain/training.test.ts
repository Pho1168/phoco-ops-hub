import { describe, expect, it } from "vitest";
import {
  canConfirmNow, canEditTraining, cleanGuide, guideHasContent, guidePhotoIds, canMarkDone, canTakeBackNow, changedAt, cleanPathway, cleanQuestion, cleanSkill, cleanVideoUrl, gradeQuiz, managesTraining,
  missingStarts, passport, progress, progressText, quizOf, quizSince, quizVersion, REDO_DAYS, shuffled, skillsFor, tally, trainingReminders, trainingSections, trainingToDo,
  type Question, type Skill, type SkillInput, type TrainingData, type TrainingEvent,
} from "./training";
import { londonToUtc } from "./time";
import type { Person, Site, SiteAccess } from "./types";

const person = (id: string, access: SiteAccess[], over: Partial<Person> = {}): Person => ({ id, staffCode: id, name: id, status: "active", pinFailed: 0, access, ...over });
const at = (siteId: SiteAccess["siteId"], role: SiteAccess["role"], sections: SiteAccess["sections"] = []): SiteAccess => ({ siteId, role, sections });
const owner = person("own", [at("EAS", "owner"), at("WEM", "owner")]);
const ops = person("ops", [at("EAS", "ops")]);
const foh = person("foh", [at("EAS", "manager", ["FOH"])]);
const chef = person("chef", [at("EAS", "manager", ["BOH"])]);
const cook = person("cook", [at("EAS", "staff", ["BOH"])]);
const server = person("srv", [at("EAS", "staff", ["FOH"])]);
const prod = person("prd", [at("WEM", "staff", ["PROD"])]);
const SITES: Site[] = [
  { id: "EAS", name: "Eastcote", kind: "restaurant", status: "open" },
  { id: "WEM", name: "Wembley", kind: "production", status: "open" },
  { id: "SYD", name: "Sydenham", kind: "restaurant", status: "closed" },
];
const T = (date: string, hm = "12:00") => londonToUtc(date, hm);
const skill = (id: string, over: Partial<Skill> = {}): Skill => ({
  id, section: "FOH", group: "Operations", position: 1, title: id, about: "", handsOn: false, induction: false, links: [], passMark: 80,
  createdAt: T("2026-10-01"), updatedAt: T("2026-10-01"), addedAt: T("2026-10-01"), linkedAt: {}, rev: 1, ...over,
});
let n = 0;
const ev = (kind: TrainingEvent["kind"], date: string, over: Partial<TrainingEvent> = {}): TrainingEvent =>
  ({ id: `e${++n}`, personId: "srv", skillId: "s", kind, at: T(date), byId: "srv", byName: "srv", ...(kind === "quiz" ? { score: 100, passed: true } : {}), ...over });
const PATH = { inductionDays: 7, allDays: 42 };
const base = { startedOn: "2026-10-05", pathway: PATH, today: "2026-10-12", hasQuiz: false };
const long = { ...base, startedOn: "2024-01-01" }; // working here all along

describe("training: who trains and who decides", () => {
  it("follows pathways for their sections as staff or manager at open sites; never owners or ops", () => {
    expect(trainingSections(server, SITES)).toEqual(["FOH"]);
    expect(trainingSections(chef, SITES)).toEqual(["BOH"]);
    expect(trainingSections(prod, SITES)).toEqual(["PROD"]);
    expect(trainingSections(owner, SITES)).toEqual([]);
    expect(trainingSections(ops, SITES)).toEqual([]);
    expect(trainingSections(person("x", [at("SYD", "staff", ["FOH"])]), SITES)).toEqual([]); // closed site
    expect(trainingSections({ ...server, status: "frozen" }, SITES)).toEqual([]);
    // An operations manager isn't a trainee, even where they're also a manager at another site.
    expect(trainingSections(person("om", [at("EAS", "ops"), at("WEM", "manager", ["PROD"])]), SITES)).toEqual([]);
    const skills = [skill("b", { position: 2 }), skill("a", { position: 1 }), skill("k", { section: "BOH" }), skill("r", { retiredAt: 1 })];
    expect(skillsFor(server, SITES, skills).map((s) => s.id)).toEqual(["a", "b"]);
    expect(skillsFor(person("both", [at("EAS", "staff", ["BOH", "FOH"])]), SITES, skills).map((s) => s.id)).toEqual(["a", "b", "k"]);
  });
  it("the owner and ops managers edit; managers look after their own sections at their site; nobody confirms themselves", () => {
    expect([owner, ops, chef, cook].map(canEditTraining)).toEqual([true, true, false, false]);
    expect(managesTraining(owner, cook, "BOH", SITES)).toEqual({ ok: true });
    expect(managesTraining(ops, cook, "BOH", SITES)).toEqual({ ok: true });
    expect(managesTraining(person("ops2", [at("WEM", "ops")]), cook, "BOH", SITES).ok).toBe(false);
    expect(managesTraining(chef, cook, "BOH", SITES)).toEqual({ ok: true });
    expect(managesTraining(foh, cook, "BOH", SITES)).toMatchObject({ ok: false, error: "A back of house manager at their site does this" });
    expect(managesTraining(chef, chef, "BOH", SITES)).toMatchObject({ ok: false, error: "Someone else confirms your own training" });
    expect(managesTraining({ ...chef, status: "frozen" }, cook, "BOH", SITES).ok).toBe(false);
  });
});

describe("training: the passport", () => {
  it("a knowledge skill: not started, in training after a failed quiz, done once passed; deadline from their start", () => {
    const s = skill("s");
    expect(progress(s, { ...base, events: [] })).toMatchObject({ state: "not_started", attempts: 0, dueOn: "2026-11-16", overdue: false });
    expect(progress({ ...s, induction: true }, { ...base, events: [] })).toMatchObject({ dueOn: "2026-10-12", overdue: false });
    expect(progress({ ...s, induction: true }, { ...base, events: [], today: "2026-10-13" })).toMatchObject({ overdue: true });
    const failed = ev("quiz", "2026-10-06", { score: 60, passed: false });
    expect(progress(s, { ...base, events: [failed] })).toMatchObject({ state: "in_training", attempts: 1, lastScore: 60 });
    const passed = ev("quiz", "2026-10-07", { score: 80, passed: true });
    expect(progress(s, { ...base, events: [passed, failed] })).toMatchObject({ state: "done", doneKind: "quiz", doneAt: passed.at, overdue: false });
    expect(progress(s, { ...base, events: [passed] }).dueOn).toBeUndefined(); // no refresher: done for good
    // A skill added after they started: its deadline runs from when it was added.
    expect(progress({ ...s, addedAt: T("2026-10-10") }, { ...base, events: [] }).dueOn).toBe("2026-11-21");
    // With no quiz yet, marking it done completes it.
    expect(progress(s, { ...base, events: [ev("done", "2026-10-08")] })).toMatchObject({ state: "done", doneKind: "done" });
  });
  it("a hands-on skill: ready once the quiz is passed (or marked ready), done when a manager confirms", () => {
    const s = skill("s", { handsOn: true });
    const passed = ev("quiz", "2026-10-07");
    const p1 = progress(s, { ...base, events: [passed] });
    expect(p1).toMatchObject({ state: "ready", readyAt: passed.at });
    expect(canConfirmNow(s, p1, true)).toEqual({ ok: true });
    expect(canConfirmNow(s, progress(s, { ...base, events: [] }), true)).toMatchObject({ ok: false, error: "They need to pass the quiz first" });
    expect(canConfirmNow(s, progress(s, { ...base, events: [] }), false)).toEqual({ ok: true }); // no quiz: a manager can confirm once seen
    const done = progress(s, { ...base, events: [passed, ev("confirmed", "2026-10-09", { byId: "chef", byName: "Chef" })] });
    expect(done).toMatchObject({ state: "done", doneKind: "confirmed", doneBy: "Chef" });
    expect(canConfirmNow(s, done, true)).toMatchObject({ ok: false, error: "It's already done" });
    expect(canConfirmNow(skill("k"), p1, true)).toMatchObject({ ok: false, error: "This one is done by passing the quiz" });
    expect(progress(s, { ...base, events: [ev("done", "2026-10-07")] }).state).toBe("ready");
    expect([canTakeBackNow(done).ok, canTakeBackNow(p1).ok, canTakeBackNow(progress(s, { ...base, events: [] })).ok]).toEqual([true, true, false]);
    // Waiting for a manager isn't overdue: they've done their part.
    const waiting = progress({ ...s, induction: true }, { ...base, startedOn: "2026-09-01", events: [passed] });
    expect(waiting).toMatchObject({ state: "ready", overdue: false, dueOn: "2026-10-08" });
    expect(progressText(waiting, base.today)).toBe("Waiting for a manager since 7 Oct 2026");
    // Saying "ready" only counts while it has no quiz: once questions are approved, the quiz comes first.
    const said = ev("done", "2026-10-07");
    expect(progress(s, { ...base, hasQuiz: true, events: [said] }).state).toBe("not_started");
    expect(canConfirmNow(s, progress(s, { ...base, hasQuiz: true, events: [said] }), true)).toMatchObject({ ok: false, error: "They need to pass the quiz first" });
  });
  it("marking done (no quiz) or ready (hands-on): not with a quiz, nor while a knowledge skill's quiz is being written", () => {
    const k = skill("k"), h = skill("h", { handsOn: true });
    const none = { asked: false, drafted: false };
    expect(canMarkDone(k, progress(k, { ...base, events: [] }), none)).toEqual({ ok: true });
    expect(canMarkDone(k, progress(k, { ...base, events: [] }), { asked: true, drafted: false })).toMatchObject({ ok: false, error: "Pass the quiz to finish this one" });
    expect(canMarkDone(k, progress(k, { ...base, events: [] }), { asked: false, drafted: true })).toMatchObject({ ok: false, error: "Its quiz is being written: you'll take it once it's ready" });
    expect(canMarkDone(h, progress(h, { ...base, events: [] }), { asked: false, drafted: true })).toEqual({ ok: true });
    expect(canMarkDone(h, progress(h, { ...base, events: [ev("done", "2026-10-07")] }), none)).toMatchObject({ ok: false, error: "It's waiting for a manager to check you" });
    expect(canMarkDone(k, progress(k, { ...base, events: [ev("done", "2026-10-07")] }), none)).toMatchObject({ ok: false, error: "It's already done" });
    // …but it can be done again once its refresher is coming up.
    const r = { ...k, refresherMonths: 12 };
    expect(canMarkDone(r, progress(r, { ...base, events: [ev("done", "2025-10-20")] }), none)).toEqual({ ok: true });
  });
  it("a refresher falls due its months after it was done; shown as coming up for the last 30 days", () => {
    const s = skill("s", { refresherMonths: 12 });
    const done = ev("quiz", "2025-10-20");
    const soon = progress(s, { ...long, events: [done] });
    expect(soon).toMatchObject({ state: "done", dueOn: "2026-10-20" });
    expect(progressText(soon, base.today)).toBe("Done 20 Oct 2025 · refresher due in 8 days");
    expect(progressText(progress(s, { ...long, events: [ev("quiz", "2026-10-01")] }), base.today)).toBe("Done 1 Oct 2026 · refresher by 1 Oct 2027");
    const due = progress(s, { ...long, events: [ev("quiz", "2025-10-12")] });
    expect(due).toMatchObject({ state: "refresher", why: "expired", dueOn: "2026-10-12", overdue: false });
    expect(progress(s, { ...long, events: [ev("quiz", "2025-10-11")] })).toMatchObject({ overdue: true });
    expect(progressText(progress(s, { ...long, events: [ev("quiz", "2025-10-11")] }), base.today)).toBe("Overdue since 11 Oct 2026");
    // Passing again puts it back in date.
    expect(progress(s, { ...long, events: [ev("quiz", "2025-10-11"), ev("quiz", "2026-10-12")] })).toMatchObject({ state: "done", dueOn: "2027-10-12" });
    // A hands-on refresher: the quiz again makes it ready for a manager.
    const h = skill("h", { handsOn: true, refresherMonths: 12 });
    const old = ev("confirmed", "2025-10-01", { byId: "chef" });
    expect(progress(h, { ...long, events: [old] }).state).toBe("refresher");
    expect(progress(h, { ...long, events: [old, ev("quiz", "2026-10-10")] })).toMatchObject({ state: "ready", why: "expired" });
    // …but a quiz from before its refresher opened (30 days before it fell due) doesn't count.
    expect(progress(h, { ...long, events: [old, ev("quiz", "2025-10-02")] })).toMatchObject({ state: "refresher", readyAt: undefined });
  });
  it("a refresher can be renewed in its last 30 days: hands-on, the quiz again then a manager, before it lapses", () => {
    const h = skill("h", { handsOn: true, refresherMonths: 12 });
    const conf = ev("confirmed", "2025-10-20", { byId: "chef" });
    const open = progress(h, { ...base, events: [conf] });
    expect(open).toMatchObject({ state: "done", renewal: true, readyAt: undefined, dueOn: "2026-10-20" });
    expect(canConfirmNow(h, open, true)).toMatchObject({ ok: false, error: "They need to pass the quiz again first" });
    expect(canConfirmNow(h, open, false)).toEqual({ ok: true }); // no quiz: a manager can watch and confirm
    const requiz = ev("quiz", "2026-10-10");
    const waiting = progress(h, { ...base, events: [conf, requiz] });
    expect(waiting).toMatchObject({ state: "done", renewal: true, readyAt: requiz.at });
    expect(canConfirmNow(h, waiting, true)).toEqual({ ok: true });
    // A quiz taken before the window opened doesn't count.
    expect(progress(h, { ...base, events: [conf, ev("quiz", "2026-01-05")] }).readyAt).toBeUndefined();
    // Confirmed again: in date for another year.
    expect(progress(h, { ...base, events: [conf, requiz, ev("confirmed", "2026-10-11", { byId: "chef" })] })).toMatchObject({ state: "done", renewal: false, dueOn: "2027-10-11" });
    // Outside the window, nothing to confirm.
    const early = progress(h, { ...base, events: [ev("confirmed", "2026-01-01", { byId: "chef" })] });
    expect(early.renewal).toBe(false);
    expect(canConfirmNow(h, early, false)).toMatchObject({ ok: false, error: "It's already done" });
  });
  it("a major change to a linked SOP or recipe, or a manager taking it back, means doing it again within 14 days", () => {
    const s = skill("s", { links: ["d1", "d2"] });
    const majors = new Map([["d1", T("2026-10-09")], ["d3", T("2026-10-11")]]);
    expect(changedAt(s, majors)).toBe(T("2026-10-09"));
    expect(changedAt(skill("x"), majors)).toBeUndefined();
    const done = ev("quiz", "2026-10-06");
    const again = progress(s, { ...base, events: [done], changedAt: T("2026-10-09") });
    expect(again).toMatchObject({ state: "refresher", why: "changed", whyOn: "2026-10-09", doneAt: done.at, dueOn: `2026-10-${9 + REDO_DAYS}`, attempts: 0 });
    expect(progress(s, { ...base, events: [done, ev("quiz", "2026-10-10")], changedAt: T("2026-10-09") }).state).toBe("done");
    const reset = ev("reset", "2026-10-08", { byId: "foh", note: "Not up to standard" });
    expect(progress(s, { ...base, events: [done, reset] })).toMatchObject({ state: "refresher", why: "reset", dueOn: "2026-10-22" });
    expect(progress(s, { ...base, events: [done, reset, ev("quiz", "2026-10-09", { score: 40, passed: false })] })).toMatchObject({ state: "refresher", attempts: 1, lastScore: 40 });
    // Taking back a skill that was only ready (never done): the quiz again, by its usual deadline or two weeks from then.
    const h = skill("h", { handsOn: true });
    expect(progress(h, { ...base, events: [ev("quiz", "2026-10-07"), ev("reset", "2026-10-08", { note: "Practise more" })] }))
      .toMatchObject({ state: "not_started", dueOn: "2026-11-16", why: "reset", whyOn: "2026-10-08" });
    expect(progress({ ...h, induction: true }, { ...base, startedOn: "2026-09-01", events: [ev("quiz", "2026-09-05"), ev("reset", "2026-10-08", { note: "Practise more" })] }))
      .toMatchObject({ dueOn: "2026-10-22", overdue: false });
  });
  it("tightening a skill later never makes anyone due sooner than is fair, nor clears what's already overdue", () => {
    const old = T("2025-01-01"), change = T("2026-10-10");
    // Linking an SOP accepts it as it is: only a major change after the link counts.
    const linked = skill("s", { links: ["d1", "d2"], linkedAt: { d1: T("2026-05-01"), d2: old } });
    expect(changedAt(linked, new Map([["d1", T("2026-04-01")]]))).toBeUndefined();
    expect(changedAt(linked, new Map([["d1", T("2026-06-01")], ["d2", T("2026-03-01")]]))).toBe(T("2026-06-01"));
    // A refresher added to a skill done long ago: two weeks from the change.
    const r = (over: Partial<Skill>) => skill("r", { refresherMonths: 12, refresherFrom: change, ...over });
    expect(progress(r({}), { ...long, events: [ev("quiz", "2024-01-01")] })).toMatchObject({ state: "refresher", why: "expired", whyOn: "2026-10-10", dueOn: "2026-10-24", overdue: false });
    // Shortened from 24 months: no later than the old one would have fallen due…
    expect(progress(r({ refresherWas: 24 }), { ...long, events: [ev("quiz", "2025-06-01")] })).toMatchObject({ dueOn: "2026-10-24", overdue: false });
    // …so someone already overdue under the old one stays overdue.
    expect(progress(r({ refresherWas: 24 }), { ...long, events: [ev("quiz", "2024-09-01")] })).toMatchObject({ dueOn: "2026-09-01", whyOn: "2026-09-01", overdue: true });
    // Done after the change: the usual date.
    expect(progress(r({ refresherFrom: T("2025-01-01") }), { ...long, events: [ev("quiz", "2025-10-11")] })).toMatchObject({ dueOn: "2026-10-11", overdue: true });
    // Made part of induction after they started: a week from the change, but no later than their old deadline.
    const i = skill("i", { induction: true, addedAt: old, inductionFrom: change });
    expect(progress(i, { ...base, startedOn: "2026-09-01", events: [] })).toMatchObject({ dueOn: "2026-10-13", overdue: false });
    expect(progress(i, { ...base, startedOn: "2026-09-20", events: [] })).toMatchObject({ dueOn: "2026-10-17", overdue: false });
    expect(progress(i, { ...base, startedOn: "2026-08-01", events: [] })).toMatchObject({ dueOn: "2026-09-12", overdue: true });
    // Moved to another pathway or brought back: it joins the pathway again, with the usual days from then.
    expect(progress(skill("m", { addedAt: change }), { ...base, startedOn: "2026-01-01", events: [] }).dueOn).toBe("2026-11-21");
    // An edit that doesn't tighten anything changes nothing (no dates move).
    expect(progress(skill("e", { induction: true, addedAt: old }), { ...base, startedOn: "2026-09-01", events: [] })).toMatchObject({ dueOn: "2026-09-08", overdue: true });
  });
  it("back after leaving or a closure: two weeks for anything to do again; a first quiz after 'ready' gives two weeks too", () => {
    const r = skill("r", { refresherMonths: 12 });
    expect(progress(r, { ...base, startedOn: "2026-10-10", events: [ev("quiz", "2025-06-01")] })).toMatchObject({ state: "refresher", dueOn: "2026-10-24", whyOn: "2026-10-10", overdue: false });
    const s = skill("s", { links: ["d1"] });
    expect(progress(s, { ...base, startedOn: "2026-10-10", events: [ev("quiz", "2026-03-01")], changedAt: T("2026-06-01") })).toMatchObject({ why: "changed", dueOn: "2026-10-24", overdue: false });
    // They'd said they were ready, then the skill got its first quiz: the quiz first, two weeks from when it came.
    const h = skill("h", { handsOn: true, addedAt: T("2026-08-01") });
    const p = progress(h, { ...base, startedOn: "2026-08-01", hasQuiz: true, quizSince: T("2026-10-11"), events: [ev("done", "2026-09-10")] });
    expect(p).toMatchObject({ state: "not_started", why: "quiz", whyOn: "2026-10-11", dueOn: "2026-10-25", overdue: false });
    expect(canConfirmNow(h, p, true)).toMatchObject({ ok: false, error: "They need to pass the quiz first" });
    // Nobody who hadn't said they were ready is affected.
    expect(progress(h, { ...base, startedOn: "2026-08-01", hasQuiz: true, quizSince: T("2026-10-11"), events: [] })).toMatchObject({ dueOn: "2026-09-12", overdue: true });
    // The same when a refresher had fallen due, or a manager had taken it back, and they'd said they were ready again.
    const hr = skill("hr", { handsOn: true, refresherMonths: 12 });
    const quizNow = { ...long, hasQuiz: true, quizSince: T("2026-10-11") };
    expect(progress(hr, { ...long, events: [ev("confirmed", "2025-10-01", { byId: "chef" }), ev("done", "2026-10-02")] })).toMatchObject({ state: "ready" });
    expect(progress(hr, { ...quizNow, events: [ev("confirmed", "2025-10-01", { byId: "chef" }), ev("done", "2026-10-02")] }))
      .toMatchObject({ state: "refresher", why: "quiz", whyOn: "2026-10-11", dueOn: "2026-10-25", overdue: false });
    expect(progress(h, { ...quizNow, events: [ev("confirmed", "2026-09-01", { byId: "chef" }), ev("reset", "2026-09-20", { byId: "chef", note: "Again" }), ev("done", "2026-09-25")] }))
      .toMatchObject({ state: "refresher", why: "quiz", dueOn: "2026-10-25", overdue: false });
  });
  it("a pathway's deadlines shortened later: the new days from the change, never later than before", () => {
    const pathway = { inductionDays: 7, allDays: 14, changedAt: T("2026-10-10"), inductionWas: 7, allWas: 90 };
    const s = skill("s", { addedAt: T("2026-01-01") });
    expect(progress(s, { ...base, pathway, startedOn: "2026-08-01", events: [] })).toMatchObject({ dueOn: "2026-10-24", overdue: false });
    expect(progress(s, { ...base, pathway, startedOn: "2026-06-01", events: [] })).toMatchObject({ dueOn: "2026-08-30", overdue: true }); // overdue before too
    expect(progress(s, { ...base, pathway, startedOn: "2026-10-11", events: [] })).toMatchObject({ dueOn: "2026-10-25" }); // started after: the new days
    // Lengthened: the new, later date.
    expect(progress(s, { ...base, pathway: { ...pathway, allDays: 120, allWas: 42 }, startedOn: "2026-08-01", events: [] }).dueOn).toBe("2026-11-29");
  });
});

describe("training: quizzes", () => {
  const qs = [{ id: "a", answer: 0 }, { id: "b", answer: 2 }, { id: "c", answer: 1 }, { id: "d", answer: 1 }, { id: "e", answer: 0 }];
  it("marks every question; passes at the pass mark exactly, never by rounding up", () => {
    expect(gradeQuiz([], {}, 80)).toMatchObject({ ok: false, error: "This skill has no quiz yet" });
    expect(gradeQuiz(qs, { a: 0, b: 2 }, 80)).toMatchObject({ ok: false, error: "Answer every question (3 left)" });
    expect(gradeQuiz(qs, { a: 0, b: 2, c: 1, d: 1 }, 80)).toMatchObject({ ok: false, error: "Answer the last question" });
    expect(gradeQuiz(qs, { a: 0, b: 2, c: 1, d: 1, e: 1 }, 80)).toEqual({ ok: true, value: { total: 5, correct: 4, score: 80, passed: true, wrong: ["e"] } });
    expect(gradeQuiz(qs, { a: 0, b: 2, c: 1, d: 0, e: 1 }, 80)).toMatchObject({ ok: true, value: { score: 60, passed: false, wrong: ["d", "e"] } });
    // 2 of 3 is 66.7%: rounds to 67, but that isn't a pass at 67.
    expect(gradeQuiz(qs.slice(0, 3), { a: 0, b: 2, c: 0 }, 67)).toMatchObject({ ok: true, value: { score: 67, passed: false } });
    expect(gradeQuiz(qs.slice(0, 3), { a: 0, b: 2, c: 0 }, 66)).toMatchObject({ ok: true, value: { passed: true } });
  });
  it("asks only approved questions, in order; shuffles fairly", () => {
    const q = (id: string, position: number, approved: boolean, skillId = "s"): Question => ({ id, skillId, position, text: id, options: ["x", "y"], answer: 0, approved, createdAt: 0, updatedAt: 0 });
    expect(quizOf("s", [q("2", 2, true), q("1", 1, true), q("d", 0, false), q("o", 1, true, "t")]).map((x) => x.id)).toEqual(["1", "2"]);
    const seq = [0.9, 0.1, 0.5];
    let i = 0;
    expect(shuffled([1, 2, 3, 4], () => seq[i++ % 3])).toEqual([3, 2, 1, 4]);
    expect(shuffled([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
  it("a quiz's version changes when a question is added, changed or taken off", () => {
    const q = (id: string, updatedAt: number) => ({ id, updatedAt });
    const v = quizVersion([q("a", 1), q("b", 2)]);
    expect(quizVersion([q("a", 1), q("b", 2)])).toBe(v);
    expect(quizVersion([q("a", 1), q("b", 3)])).not.toBe(v);
    expect(quizVersion([q("a", 1)])).not.toBe(v);
    expect(quizVersion([q("a", 1), q("b", 2), q("c", 2)])).not.toBe(v);
    // When its quiz started being asked: its earliest approved question.
    const a = (skillId: string, approved: boolean, approvedAt?: number) => ({ skillId, approved, approvedAt });
    expect(quizSince("s", [a("s", true, 5), a("s", true, 3), a("s", false), a("t", true, 1)])).toBe(3);
    expect(quizSince("s", [a("s", false)])).toBeUndefined();
  });
});

describe("training: what the editors send", () => {
  const input = (over: Partial<SkillInput> = {}): SkillInput => ({
    section: "BOH", group: " Kitchen ", title: "  Knife   skills ", about: "Grip, claw, cleaning down.  ", handsOn: true, induction: false,
    links: ["8F0C8E3A-1C2D-4E5F-9A0B-1C2D3E4F5A6B", "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b"], videoUrl: " https://youtu.be/abc123 ", refresherMonths: 12, passMark: 80, ...over,
  });
  it("tidies a skill and checks its limits", () => {
    expect(cleanSkill(input())).toEqual({
      ok: true,
      value: { section: "BOH", group: "Kitchen", title: "Knife skills", about: "Grip, claw, cleaning down.", handsOn: true, induction: false,
        links: ["8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b"], videoUrl: "https://youtu.be/abc123", refresherMonths: 12, passMark: 80 },
    });
    expect(cleanSkill(input({ videoUrl: "", refresherMonths: null }))).toMatchObject({ ok: true, value: { title: "Knife skills" } });
    expect((cleanSkill(input({ videoUrl: "", refresherMonths: null })) as { value: object }).value).not.toHaveProperty("videoUrl");
    expect(cleanSkill(input({ section: "BAR" }))).toMatchObject({ ok: false, error: "Choose the pathway" });
    expect(cleanSkill(input({ title: " " }))).toMatchObject({ ok: false, error: "Give the skill a name" });
    expect(cleanSkill(input({ group: "" })).ok).toBe(false);
    expect(cleanSkill(input({ links: ["not-a-doc"] }))).toMatchObject({ ok: false, error: "One of the links isn't an SOP or recipe" });
    expect(cleanSkill(input({ refresherMonths: 0 })).ok).toBe(false);
    expect(cleanSkill(input({ refresherMonths: 61 })).ok).toBe(false);
    expect(cleanSkill(input({ passMark: 49 })).ok).toBe(false);
    expect(cleanSkill(input({ passMark: 80.5 })).ok).toBe(false);
  });
  it("takes https video links only", () => {
    expect(cleanVideoUrl("http://youtu.be/x")).toMatchObject({ ok: false });
    expect(cleanVideoUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(cleanVideoUrl("youtube.com/watch?v=1")).toMatchObject({ ok: false });
    expect(cleanVideoUrl("https://localhost/x")).toMatchObject({ ok: false });
    expect(cleanVideoUrl("https://vimeo.com/123")).toEqual({ ok: true, value: "https://vimeo.com/123" });
  });
  it("a question: blank answers dropped, the right one kept, no repeats", () => {
    expect(cleanQuestion({ text: " Fridges run at? ", options: ["0–5°C", "", " 8–10°C ", "Room temperature"], answer: 2 }))
      .toEqual({ ok: true, value: { text: "Fridges run at?", options: ["0–5°C", "8–10°C", "Room temperature"], answer: 1 } });
    expect(cleanQuestion({ text: "Q", options: ["a", "", "b"], answer: 1 })).toMatchObject({ ok: false, error: "Choose which answer is right" });
    expect(cleanQuestion({ text: "Q", options: ["a", "A"], answer: 0 })).toMatchObject({ ok: false, error: "Two answers are the same" });
    expect(cleanQuestion({ text: "Q", options: ["a", ""], answer: 0 })).toMatchObject({ ok: false, error: "Give at least two answers to choose from" });
    expect(cleanQuestion({ text: "", options: ["a", "b"], answer: 0 })).toMatchObject({ ok: false, error: "Write the question" });
    expect(cleanQuestion({ text: "Q", options: ["1", "2", "3", "4", "5", "6", "7"], answer: 0 }).ok).toBe(false);
  });
  it("pathway deadlines", () => {
    expect(cleanPathway({ inductionDays: 7, allDays: 42 })).toEqual({ ok: true, value: { inductionDays: 7, allDays: 42 } });
    expect(cleanPathway({ inductionDays: 50, allDays: 42 })).toMatchObject({ ok: false, error: "Induction can't take longer than everything" });
    expect(cleanPathway({ inductionDays: 0, allDays: 42 }).ok).toBe(false);
    expect(cleanPathway({ inductionDays: 7, allDays: 400 }).ok).toBe(false);
  });
});

describe("training: managers and messages", () => {
  const skills = [skill("ops1", { induction: true }), skill("pho", { section: "BOH", handsOn: true, position: 1 }), skill("knife", { section: "BOH", handsOn: true, position: 2, refresherMonths: 12 })];
  const q = (skillId: string, approved: boolean): Question => ({ id: `q-${skillId}-${approved}`, skillId, position: 1, text: "?", options: ["a", "b"], answer: 0, approved, createdAt: 0, updatedAt: 0 });
  const data = (events: TrainingEvent[], over: Partial<TrainingData> = {}): TrainingData => ({
    skills, questions: [q("pho", true), q("knife", false)], events,
    starts: [{ personId: "cook", section: "BOH", startedOn: "2025-01-01" }, { personId: "srv", section: "FOH", startedOn: "2026-09-01" }],
    pathways: [{ section: "FOH", inductionDays: 7, allDays: 42 }], majorChanges: new Map(), ...over,
  });
  it("a passport and its tally; managers see what they can confirm, who is overdue, and (owner, ops) questions to approve", () => {
    const d = data([ev("quiz", "2026-10-05", { personId: "cook", skillId: "pho", byId: "cook" })]);
    const rows = passport(cook, SITES, d, "2026-10-12");
    expect(rows.map((r) => [r.skill.id, r.progress.state, r.hasQuiz, r.drafted])).toEqual([["pho", "ready", true, false], ["knife", "not_started", false, true]]);
    expect(tally(rows)).toEqual({ total: 2, done: 0, overdue: 0, ready: 1, again: 0 });
    expect(trainingToDo(chef, [cook, server, chef], SITES, d, "2026-10-12")).toEqual({ ready: 1, overdue: 0, toApprove: 0 });
    expect(trainingToDo(foh, [cook, server, foh], SITES, d, "2026-10-12")).toEqual({ ready: 0, overdue: 1, toApprove: 0 }); // the server's induction is overdue
    expect(trainingToDo(owner, [cook, server], SITES, d, "2026-10-12")).toEqual({ ready: 1, overdue: 1, toApprove: 1 });
    expect(trainingToDo(cook, [cook], SITES, d, "2026-10-12")).toEqual({ ready: 0, overdue: 0, toApprove: 0 });
    // A refresher being renewed counts as waiting for the manager, and in the tally.
    const renewing = data([ev("confirmed", "2025-10-20", { personId: "cook", skillId: "knife", byId: "chef" }), ev("quiz", "2026-10-10", { personId: "cook", skillId: "knife", byId: "cook" })]);
    expect(tally(passport(cook, SITES, renewing, "2026-10-12"))).toMatchObject({ done: 1, ready: 1 });
    expect(trainingToDo(chef, [cook], SITES, renewing, "2026-10-12").ready).toBe(1);
    // Everyone training with no start yet starts today (the scheduler, on go-live); until then, as if they start today.
    expect(missingStarts([cook, server, owner, ops, chef], SITES, [{ personId: "cook", section: "BOH", startedOn: "2026-01-01" }], "2026-10-12")).toEqual([
      { personId: "srv", section: "FOH", startedOn: "2026-10-12" }, { personId: "chef", section: "BOH", startedOn: "2026-10-12" }]);
    expect(passport(server, SITES, data([], { starts: [] }), "2026-10-12")[0].progress).toMatchObject({ dueOn: "2026-10-19", overdue: false });
    // Starting again (back from leaving, say): the latest start counts.
    const back = data([], { starts: [{ personId: "srv", section: "FOH", startedOn: "2026-01-01" }, { personId: "srv", section: "FOH", startedOn: "2026-10-10" }] });
    expect(passport(server, SITES, back, "2026-10-12")[0].progress).toMatchObject({ dueOn: "2026-10-17", overdue: false });
  });
  it("reminders: a refresher coming up, a refresher due, and doing it again after a change; once each, never for old dates", () => {
    const cookEv = (kind: TrainingEvent["kind"], date: string) => ev(kind, date, { personId: "cook", skillId: "knife", byId: "chef" });
    const keys = (events: TrainingEvent[], today: string, over: Partial<TrainingData> = {}) => trainingReminders([cook], SITES, data(events, over), today).map((m) => m.dedupeKey);
    expect(keys([cookEv("confirmed", "2025-11-01")], "2026-10-12")).toEqual(["training|cook|knife|soon|2026-11-01"]);
    expect(keys([cookEv("confirmed", "2025-11-30")], "2026-10-12")).toEqual([]); // 49 days to go
    expect(keys([cookEv("confirmed", "2025-10-05")], "2026-10-12")).toEqual(["training|cook|knife|due|2026-10-05"]);
    expect(keys([cookEv("confirmed", "2025-09-01")], "2026-10-12")).toEqual([]); // due over two weeks ago: no message now
    const linked = { skills: skills.map((s) => (s.id === "knife" ? { ...s, links: ["sop"], refresherMonths: undefined } : s)) };
    expect(keys([cookEv("confirmed", "2026-10-02")], "2026-10-12", { ...linked, majorChanges: new Map([["sop", T("2026-10-10")]]) })).toEqual(["training|cook|knife|again|2026-10-10"]);
    expect(keys([cookEv("confirmed", "2026-10-02")], "2026-10-12", { ...linked, majorChanges: new Map([["sop", T("2026-09-20")]]) })).toEqual([]);
    // Nothing while they're waiting for a manager (the refresher is being renewed).
    expect(keys([cookEv("confirmed", "2025-11-01"), ev("quiz", "2026-10-05", { personId: "cook", skillId: "knife", byId: "cook" })], "2026-10-12")).toEqual([]);
    // A refresher added to a skill done long ago: "do it again" by two weeks from the change.
    const added = { skills: skills.map((s) => (s.id === "knife" ? { ...s, refresherFrom: T("2026-10-10") } : s)) };
    const m = trainingReminders([cook], SITES, data([cookEv("confirmed", "2024-01-01")], added), "2026-10-12");
    expect(m.map((x) => [x.dedupeKey, x.body])).toEqual([["training|cook|knife|again|2026-10-10", "Its refresher has fallen due. Please do it by 24 Oct 2026."]]);
    // A manager took back a skill that was only ready: asked to do it again.
    const taken = [ev("quiz", "2026-10-05", { personId: "cook", skillId: "pho", byId: "cook" }), ev("reset", "2026-10-11", { personId: "cook", skillId: "pho", byId: "chef", note: "Practise more" })];
    expect(trainingReminders([cook], SITES, data(taken), "2026-10-12").map((x) => [x.dedupeKey, x.title])).toEqual([["training|cook|pho|again|2026-10-11", "Do it again: pho"]]);
  });
});

describe("the guide (training card)", () => {
  const P = { id: "00000000-0000-4000-8000-0000000000e1", w: 800, h: 600 };
  it("trims, drops blank rows and keeps photos", () => {
    const r = cleanGuide({
      tagline: "  Clean hands · safe food ", why: "Hands carry bacteria.\n\n", when: ["Before food", "", "  After the toilet "],
      steps: [{ text: " Wet hands ", photo: P }, { text: "", warning: "" }, { text: "Soap", warning: " One press " }],
      never: ["Rinse without soap"], looks: [], closing: "Clean hands, brighter days",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      tagline: "Clean hands · safe food", why: "Hands carry bacteria.", when: ["Before food", "After the toilet"],
      steps: [{ text: "Wet hands", photo: P }, { text: "Soap", warning: "One press" }], never: ["Rinse without soap"], looks: [], closing: "Clean hands, brighter days",
    });
    expect(guideHasContent(r.value)).toBe(true);
    expect(guidePhotoIds(r.value)).toEqual([P.id]);
  });
  it("accepts an empty guide (no card shown) and refuses bad photos and oversize lists", () => {
    const e = cleanGuide({});
    expect(e.ok && !guideHasContent(e.value)).toBe(true);
    const bad = cleanGuide({ steps: [{ text: "x", photo: { id: "nope", w: 1, h: 1 } }] });
    expect(bad.ok && bad.value.steps[0].photo).toBeUndefined();
    expect(cleanGuide({ never: Array.from({ length: 11 }, (_, i) => `n${i}`) }).ok).toBe(false);
    expect(cleanGuide({ steps: [{ warning: "only a warning" }] }).ok).toBe(false);
    expect(cleanGuide({ steps: Array.from({ length: 13 }, () => ({ text: "s" })) }).ok).toBe(false);
  });
});
