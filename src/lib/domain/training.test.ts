import { describe, expect, it } from "vitest";
import {
  canConfirmNow, canEditTraining, canTakeBackNow, changedAt, cleanPathway, cleanQuestion, cleanSkill, cleanVideoUrl, gradeQuiz, managesTraining,
  passport, progress, progressText, quizOf, quizVersion, REDO_DAYS, shuffled, skillsFor, tally, trainingReminders, trainingSections, trainingToDo,
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
  createdAt: T("2026-10-01"), updatedAt: T("2026-10-01"), rev: 1, ...over,
});
let n = 0;
const ev = (kind: TrainingEvent["kind"], date: string, over: Partial<TrainingEvent> = {}): TrainingEvent =>
  ({ id: `e${++n}`, personId: "srv", skillId: "s", kind, at: T(date), byId: "srv", byName: "srv", ...(kind === "quiz" ? { score: 100, passed: true } : {}), ...over });
const PATH = { inductionDays: 7, allDays: 42 };
const base = { startedOn: "2026-10-05", pathway: PATH, today: "2026-10-12" };

describe("training: who trains and who decides", () => {
  it("follows pathways for their sections as staff or manager at open sites; never owners or ops", () => {
    expect(trainingSections(server, SITES)).toEqual(["FOH"]);
    expect(trainingSections(chef, SITES)).toEqual(["BOH"]);
    expect(trainingSections(prod, SITES)).toEqual(["PROD"]);
    expect(trainingSections(owner, SITES)).toEqual([]);
    expect(trainingSections(ops, SITES)).toEqual([]);
    expect(trainingSections(person("x", [at("SYD", "staff", ["FOH"])]), SITES)).toEqual([]); // closed site
    expect(trainingSections({ ...server, status: "frozen" }, SITES)).toEqual([]);
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
    expect(progress(s, { ...base, events: [passed, failed] })).toMatchObject({ state: "done", doneKind: "quiz", doneAt: passed.at, dueOn: undefined, overdue: false });
    // A skill added after they started: its deadline runs from when it was added.
    expect(progress({ ...s, createdAt: T("2026-10-10") }, { ...base, events: [] }).dueOn).toBe("2026-11-21");
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
  });
  it("a refresher falls due its months after it was done; shown as coming up for the last 30 days", () => {
    const s = skill("s", { refresherMonths: 12 });
    const done = ev("quiz", "2025-10-20");
    const soon = progress(s, { ...base, events: [done] });
    expect(soon).toMatchObject({ state: "done", dueOn: "2026-10-20" });
    expect(progressText(soon, base.today)).toBe("Done 20 Oct 2025 · refresher due in 8 days");
    expect(progressText(progress(s, { ...base, events: [ev("quiz", "2026-10-01")] }), base.today)).toBe("Done 1 Oct 2026 · refresher by 1 Oct 2027");
    const due = progress(s, { ...base, events: [ev("quiz", "2025-10-12")] });
    expect(due).toMatchObject({ state: "refresher", why: "expired", dueOn: "2026-10-12", overdue: false });
    expect(progress(s, { ...base, events: [ev("quiz", "2025-10-11")] })).toMatchObject({ overdue: true });
    expect(progressText(progress(s, { ...base, events: [ev("quiz", "2025-10-11")] }), base.today)).toBe("Overdue since 11 Oct 2026");
    // Passing again puts it back in date.
    expect(progress(s, { ...base, events: [ev("quiz", "2025-10-11"), ev("quiz", "2026-10-12")] })).toMatchObject({ state: "done", dueOn: "2027-10-12" });
    // A hands-on refresher: the quiz again makes it ready for a manager.
    const h = skill("h", { handsOn: true, refresherMonths: 12 });
    const old = ev("confirmed", "2025-10-01", { byId: "chef" });
    expect(progress(h, { ...base, events: [old] }).state).toBe("refresher");
    expect(progress(h, { ...base, events: [old, ev("quiz", "2026-10-10")] })).toMatchObject({ state: "ready", why: "expired" });
  });
  it("a major change to a linked SOP or recipe, or a manager taking it back, means doing it again within 14 days", () => {
    const s = skill("s", { links: ["d1", "d2"] });
    const majors = new Map([["d1", T("2026-10-09")], ["d3", T("2026-10-11")]]);
    expect(changedAt(s, majors)).toBe(T("2026-10-09"));
    expect(changedAt(skill("x"), majors)).toBeUndefined();
    const done = ev("quiz", "2026-10-06");
    const again = progress(s, { ...base, events: [done], changedAt: T("2026-10-09") });
    expect(again).toMatchObject({ state: "refresher", why: "changed", doneAt: done.at, dueOn: `2026-10-${9 + REDO_DAYS}`, attempts: 0 });
    expect(progress(s, { ...base, events: [done, ev("quiz", "2026-10-10")], changedAt: T("2026-10-09") }).state).toBe("done");
    const reset = ev("reset", "2026-10-08", { byId: "foh", note: "Not up to standard" });
    expect(progress(s, { ...base, events: [done, reset] })).toMatchObject({ state: "refresher", why: "reset", dueOn: "2026-10-22" });
    expect(progress(s, { ...base, events: [done, reset, ev("quiz", "2026-10-09", { score: 40, passed: false })] })).toMatchObject({ state: "refresher", attempts: 1, lastScore: 40 });
    // Taking back a skill that was only ready (never done) starts it afresh, with its usual deadline.
    const h = skill("h", { handsOn: true });
    expect(progress(h, { ...base, events: [ev("quiz", "2026-10-07"), ev("reset", "2026-10-08", { note: "Practise more" })] })).toMatchObject({ state: "not_started", dueOn: "2026-11-16" });
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
    starts: [{ personId: "cook", section: "BOH", startedOn: "2026-10-01" }, { personId: "srv", section: "FOH", startedOn: "2026-09-01" }],
    pathways: [{ section: "FOH", inductionDays: 7, allDays: 42 }], majorChanges: new Map(), ...over,
  });
  it("a passport and its tally; managers see what they can confirm, who is overdue, and (owner, ops) questions to approve", () => {
    const d = data([ev("quiz", "2026-10-05", { personId: "cook", skillId: "pho", byId: "cook" })]);
    const rows = passport(cook, SITES, d, "2026-10-12");
    expect(rows.map((r) => [r.skill.id, r.progress.state, r.hasQuiz])).toEqual([["pho", "ready", true], ["knife", "not_started", false]]);
    expect(tally(rows)).toEqual({ total: 2, done: 0, overdue: 0, ready: 1, again: 0 });
    expect(trainingToDo(chef, [cook, server, chef], SITES, d, "2026-10-12")).toEqual({ ready: 1, overdue: 0, toApprove: 0 });
    expect(trainingToDo(foh, [cook, server, foh], SITES, d, "2026-10-12")).toEqual({ ready: 0, overdue: 1, toApprove: 0 }); // the server's induction is overdue
    expect(trainingToDo(owner, [cook, server], SITES, d, "2026-10-12")).toEqual({ ready: 1, overdue: 1, toApprove: 1 });
    expect(trainingToDo(cook, [cook], SITES, d, "2026-10-12")).toEqual({ ready: 0, overdue: 0, toApprove: 0 });
  });
  it("reminders: a refresher coming up, a refresher due, and doing it again after a change; once each, never for old dates", () => {
    const cookEv = (kind: TrainingEvent["kind"], date: string) => ev(kind, date, { personId: "cook", skillId: "knife", byId: "chef" });
    const keys = (events: TrainingEvent[], today: string, over: Partial<TrainingData> = {}) => trainingReminders([cook], SITES, data(events, over), today).map((m) => m.dedupeKey);
    expect(keys([cookEv("confirmed", "2025-11-01")], "2026-10-12")).toEqual(["training|cook|knife|soon|2026-11-01"]);
    expect(keys([cookEv("confirmed", "2025-11-30")], "2026-10-12")).toEqual([]); // 49 days to go
    expect(keys([cookEv("confirmed", "2025-10-05")], "2026-10-12")).toEqual(["training|cook|knife|due|2026-10-05"]);
    expect(keys([cookEv("confirmed", "2025-09-01")], "2026-10-12")).toEqual([]); // due over two weeks ago: no message now
    const linked = { skills: skills.map((s) => (s.id === "knife" ? { ...s, links: ["sop"], refresherMonths: undefined } : s)) };
    expect(keys([cookEv("confirmed", "2026-10-02")], "2026-10-12", { ...linked, majorChanges: new Map([["sop", T("2026-10-10")]]) })).toEqual(["training|cook|knife|again|2026-10-24"]);
    expect(keys([cookEv("confirmed", "2026-10-02")], "2026-10-12", { ...linked, majorChanges: new Map([["sop", T("2026-09-20")]]) })).toEqual([]);
  });
});
