import { isOps, isOwner, opsSites } from "./access";
import { addMonths } from "./equipment";
import { canApprove, cleanText, type Checked, type Cleaned } from "./library";
import { addDays, dayMonthYear, daysBetween, londonDate, londonToUtc } from "./time";
import type { Area, Person, Site } from "./types";

/**
 * The Training Academy. A skill is one thing someone must be able to do; skills come in pathways, one per section
 * (front of house, back of house, production), in order. A skill may link to SOPs and recipes to read and a video to
 * watch, and may have a quiz.
 * - A knowledge skill is done when its quiz is passed (or, while it has no quiz, when the person marks it done).
 * - A hands-on skill is done when a manager confirms it after watching them do it (once the quiz is passed, if it has one).
 * Each person's skills passport is worked out from append-only training events. A completion stops counting when its
 * refresher falls due (it can be done again from 30 days before), when an SOP or recipe it links to gets a major change
 * after it (only changes made while it was linked), or when a manager takes it back; the last two leave two weeks to do
 * it again. Deadlines run from the day someone (re)started training in that section or the skill joined their pathway.
 * Tightening a skill later (making it part of induction, a shorter refresher, a first quiz for someone who'd said they
 * were ready) never makes anyone due sooner than two weeks (a week for induction) from the change, nor sooner than they
 * were. The owner and operations managers set the skills, quizzes and deadlines; a drafted question is only asked once
 * one of them has approved it.
 */

export const PATHWAYS: Area[] = ["FOH", "BOH", "PROD"];
export const PATHWAY_TEXT: Record<Area, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };

export interface Skill {
  id: string;
  section: Area;
  /** The heading it sits under in its pathway: Operations, Service, Drinks… */
  group: string;
  /** Its place in the pathway (1, 2, 3…). */
  position: number;
  title: string;
  /** What it covers. */
  about: string;
  /** A manager confirms it after watching them do it. */
  handsOn: boolean;
  /** Due within the pathway's induction days; otherwise within its "everything" days. */
  induction: boolean;
  /** Library documents to read: SOPs, prep recipes, dishes. */
  links: string[];
  videoUrl?: string;
  /** Done again after this many months. */
  refresherMonths?: number;
  /** Percent of questions right to pass the quiz. */
  passMark: number;
  createdAt: number;
  updatedAt: number;
  /** When it joined its pathway: added, moved to another pathway or brought back. Nobody is due before it plus the pathway's days. */
  addedAt: number;
  /** When it was last made part of induction (after it was added). */
  inductionFrom?: number;
  /** When its refresher last changed, and what it was before (months; none if unset). */
  refresherFrom?: number;
  refresherWas?: number;
  /** When each linked SOP or recipe was linked: only a major change after that counts. */
  linkedAt: Record<string, number>;
  rev: number;
  retiredAt?: number;
}

export interface Question {
  id: string;
  skillId: string;
  position: number;
  text: string;
  options: string[];
  /** Index into `options`. Never sent to the person taking the quiz. */
  answer: number;
  approved: boolean;
  approvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A pathway's deadlines, in days from the day someone started in that section. `changedAt`, `inductionWas` and
 * `allWas`: when they last changed and from what, so shortening them is fair to people already training.
 */
export interface Pathway { section: Area; inductionDays: number; allDays: number; changedAt?: number; inductionWas?: number; allWas?: number }
export const DEFAULT_PATHWAY = { inductionDays: 7, allDays: 42 } as const;

/**
 * What happened, never changed or deleted:
 * - quiz: an attempt, with its score and whether it passed;
 * - done: the person marked it done (a skill with no quiz) or ready to be checked (hands-on);
 * - confirmed: a manager confirmed it (hands-on);
 * - reset: a manager took it back (with why): it has to be done again.
 */
export type EventKind = "quiz" | "done" | "confirmed" | "reset";
export interface TrainingEvent {
  id: string; personId: string; skillId: string; kind: EventKind; at: number; byId: string; byName?: string;
  score?: number; passed?: boolean; note?: string;
}

/** When someone started in a section (their pathway's deadlines run from then). */
export interface TrainingStart { personId: string; section: Area; startedOn: string }

export const TRAINING_LIMITS = { title: 100, group: 40, about: 600, url: 500, question: 300, option: 150, options: 6, questions: 30, links: 10, refresherMonths: 60 } as const;
/** After a major change to a linked SOP or recipe, or a manager taking it back: this long to do it again. */
export const REDO_DAYS = 14;
/** A refresher shows as coming up, and the person is told, this many days before it falls due. */
export const REFRESHER_SOON_DAYS = 30;
/** A "refresher due" or "do it again" message only goes this soon after the date, so old records don't send a flood. */
export const TRAINING_REMINDER_DAYS = 14;

const yes: Checked = { ok: true };
const no = (error: string): Checked => ({ ok: false, error });
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- who trains, who decides ----------

/**
 * The pathways someone follows: their sections as staff or a manager at open sites. Owners and operations managers
 * don't (even where they're also a manager or staff at another site).
 */
export function trainingSections(p: Pick<Person, "status" | "access">, sites: Pick<Site, "id" | "status">[]): Area[] {
  if (p.status !== "active" || isOwner(p) || isOps(p)) return [];
  const open = new Set(sites.filter((s) => s.status === "open").map((s) => s.id));
  return PATHWAYS.filter((sec) => p.access.some((a) => (a.role === "staff" || a.role === "manager") && open.has(a.siteId) && a.sections.includes(sec)));
}

/** Pathway order: by section, then position. */
export const bySkillOrder = (a: Pick<Skill, "section" | "position" | "title">, b: Pick<Skill, "section" | "position" | "title">) =>
  PATHWAYS.indexOf(a.section) - PATHWAYS.indexOf(b.section) || a.position - b.position || a.title.localeCompare(b.title);

/** The live skills someone has to do, in pathway order. */
export function skillsFor<S extends Pick<Skill, "section" | "position" | "title" | "retiredAt">>(p: Pick<Person, "status" | "access">, sites: Pick<Site, "id" | "status">[], skills: S[]): S[] {
  const mine = trainingSections(p, sites);
  return skills.filter((s) => !s.retiredAt && mine.includes(s.section)).sort(bySkillOrder);
}

/** The owner and operations managers set the skills, quizzes and deadlines, and approve drafted questions. */
export const canEditTraining = (p: Pick<Person, "status" | "access">) => canApprove(p);

/**
 * Whether someone looks after this person's training in a section: the owner; an operations manager at one of their
 * open sites; a manager there whose own sections include it (a head chef for kitchen skills). Never themselves.
 */
export function managesTraining(actor: Pick<Person, "id" | "status" | "access">, trainee: Pick<Person, "id" | "access">, section: Area,
  sites: Pick<Site, "id" | "status">[]): Checked {
  if (actor.status !== "active") return no("Your account isn't active");
  if (actor.id === trainee.id) return no("Someone else confirms your own training");
  if (isOwner(actor)) return yes;
  const open = new Set(sites.filter((s) => s.status === "open").map((s) => s.id));
  const theirs = trainee.access.filter((a) => open.has(a.siteId)).map((a) => a.siteId);
  if (isOps(actor) && opsSites(actor).some((s) => theirs.includes(s))) return yes;
  if (actor.access.some((a) => a.role === "manager" && theirs.includes(a.siteId) && a.sections.includes(section))) return yes;
  return no(`A ${PATHWAY_TEXT[section].toLowerCase()} manager at their site does this`);
}

// ---------- the passport ----------

export type SkillState = "not_started" | "in_training" | "ready" | "done" | "refresher";
export const STATE_TEXT: Record<SkillState, string> = {
  not_started: "Not started", in_training: "In training", ready: "Ready to be checked", done: "Done", refresher: "To do again",
};

export interface Progress {
  state: SkillState;
  /** The completion that counts, or the last one before it has to be done again. */
  doneAt?: number;
  doneBy?: string;
  doneKind?: "quiz" | "done" | "confirmed";
  /**
   * Hands-on: they've passed the quiz (or, with no quiz, said they're ready) since it last had to be done, or since its
   * refresher opened: a manager can confirm it.
   */
  readyAt?: number;
  /** Done, and its refresher falls due within REFRESHER_SOON_DAYS: it can be done again now to keep it in date. */
  renewal?: boolean;
  /** Quiz attempts since it last had to be (re)done, and the latest score. */
  attempts: number;
  lastScore?: number;
  /** Done: when its refresher falls due. Otherwise: its deadline. */
  dueOn?: string;
  /** Not done and past its deadline (never while it's waiting for a manager: they've done their part). */
  overdue: boolean;
  /**
   * Why it has to be done (again): its refresher fell due, a linked SOP or recipe changed, a manager took it back, or
   * it got a quiz after they'd said they were ready.
   */
  why?: "expired" | "changed" | "reset" | "quiz";
  /** The day it had to be done again from (with `why`). */
  whyOn?: string;
}

export interface ProgressInput {
  /** This person's events for this skill (any order). */
  events: TrainingEvent[];
  /** When they (re)started training in the skill's section. */
  startedOn?: string;
  pathway: Pick<Pathway, "inductionDays" | "allDays" | "changedAt" | "inductionWas" | "allWas">;
  /** The latest major change to an SOP or recipe it links to. */
  changedAt?: number;
  /** It has a quiz (approved questions) now, asked since this time (its earliest approved question). */
  hasQuiz: boolean;
  quizSince?: number;
  today: string;
}

/** Where someone stands on one skill (see the module notes for the rules). */
export function progress(skill: Pick<Skill, "handsOn" | "induction" | "refresherMonths" | "addedAt" | "inductionFrom" | "refresherFrom" | "refresherWas">, x: ProgressInput): Progress {
  const evs = [...x.events].sort((a, b) => a.at - b.at);
  const lastReset = Math.max(0, ...evs.filter((e) => e.kind === "reset").map((e) => e.at));
  const cutoff = Math.max(lastReset, x.changedAt ?? 0);
  const completes = (e: TrainingEvent) => e.kind === "confirmed" || (!skill.handsOn && (e.kind === "done" || (e.kind === "quiz" && !!e.passed)));
  // Ready for a manager's check: the quiz passed, or (only while it has no quiz) they said they're ready.
  const readies = (e: TrainingEvent) => skill.handsOn && ((e.kind === "quiz" && !!e.passed) || (e.kind === "done" && !x.hasQuiz));
  const valid = evs.filter((e) => e.at > cutoff);
  const done = valid.filter(completes).at(-1);
  const prior = evs.filter((e) => e.at <= cutoff && completes(e)).at(-1);
  const since = Math.max(cutoff, done?.at ?? 0);
  const attemptsSince = (t: number) => evs.filter((e) => e.kind === "quiz" && e.at > t);
  const readyAfter = (t: number) => evs.filter((e) => e.at > t && readies(e)).at(-1)?.at;
  const base = (state: SkillState, extra: Partial<Progress>): Progress => {
    const attempts = attemptsSince(since);
    return { state, attempts: attempts.length, lastScore: attempts.at(-1)?.score, overdue: false, ...extra };
  };
  const finish = (p: Progress): Progress => ({ ...p, overdue: p.state !== "done" && p.state !== "ready" && !!p.dueOn && p.dueOn < x.today });
  const who = (e: TrainingEvent) => ({ doneAt: e.at, doneBy: e.byName, doneKind: e.kind as Progress["doneKind"] });
  type Due = { dueOn: string; why?: Progress["why"]; whyOn?: string };
  const later = (a: Due, b?: Due): Due => (b && b.dueOn > a.dueOn ? b : a);
  const grace = (from: string, why?: Progress["why"]): Due => ({ dueOn: addDays(from, REDO_DAYS), whyOn: from, ...(why ? { why } : {}) });
  // Back after leaving or a site closure (a new start): at least REDO_DAYS from then for anything to do again.
  const back = (why: Progress["why"]) => (x.startedOn ? grace(x.startedOn, why) : undefined);
  // They'd said they were ready (since `from`) while it had no quiz, and then it got one: the quiz first, with
  // REDO_DAYS from when it came.
  const newQuiz = (from: number, ready?: number): Due | undefined =>
    !ready && skill.handsOn && x.hasQuiz && x.quizSince && evs.some((e) => e.kind === "done" && e.at > from && e.at < x.quizSince!)
      ? grace(londonDate(x.quizSince), "quiz") : undefined;

  if (done) {
    const expires = skill.refresherMonths ? addMonths(londonDate(done.at), skill.refresherMonths) : undefined;
    if (!expires) return finish(base("done", who(done)));
    // From REFRESHER_SOON_DAYS before its refresher falls due it can be done again the same way (for a hands-on skill,
    // the quiz and then a manager); only what's done from then on counts.
    const opens = Math.max(done.at, londonToUtc(addDays(expires, -REFRESHER_SOON_DAYS), "00:00"));
    const readyAt = readyAfter(opens);
    if (expires > x.today) return finish(base("done", { ...who(done), dueOn: expires, readyAt, renewal: daysBetween(x.today, expires) <= REFRESHER_SOON_DAYS }));
    // Its refresher has fallen due. If the refresher was changed after they did it: no sooner than under the old one
    // (none: never), or two weeks after the change, whichever comes first.
    let due: Due = { dueOn: expires, whyOn: expires, why: "expired" };
    if (skill.refresherFrom && done.at < skill.refresherFrom) {
      const g = grace(londonDate(skill.refresherFrom), "expired");
      const was = skill.refresherWas ? addMonths(londonDate(done.at), skill.refresherWas) : undefined;
      due = later(due, was && was < g.dueOn ? { dueOn: was, whyOn: was, why: "expired" } : g);
    }
    due = later(later(due, back("expired")), newQuiz(opens, readyAt));
    return finish(base(readyAt ? "ready" : "refresher", { ...who(done), readyAt, ...due }));
  }
  const readyAt = readyAfter(cutoff);
  if (prior) {
    const why = lastReset >= (x.changedAt ?? 0) ? "reset" : "changed";
    const due = later(later(grace(londonDate(cutoff), why), back(why)), newQuiz(cutoff, readyAt));
    return finish(base(readyAt ? "ready" : "refresher", { ...who(prior), readyAt, ...due }));
  }
  // Never done: due a set time after they started in the section or it joined their pathway, whichever is later.
  const added = londonDate(skill.addedAt);
  const start = x.startedOn && x.startedOn > added ? x.startedOn : added;
  const pw = x.pathway;
  const days = (induction: number, all: number) => (skill.induction ? induction : all);
  let due: Due = { dueOn: addDays(start, days(pw.inductionDays, pw.allDays)) };
  // The pathway's deadlines were shortened after they started: the new days from the change, but no later than before.
  if (pw.changedAt) {
    const change = addDays(londonDate(pw.changedAt), days(pw.inductionDays, pw.allDays));
    const before = addDays(start, days(pw.inductionWas ?? pw.inductionDays, pw.allWas ?? pw.allDays));
    due = later(due, { dueOn: change < before ? change : before });
  }
  // Made part of induction after they started: the induction days from the change, but no later than before.
  if (skill.induction && skill.inductionFrom) {
    const change = addDays(londonDate(skill.inductionFrom), pw.inductionDays), before = addDays(start, pw.allDays);
    due = later(due, { dueOn: change < before ? change : before });
  }
  // A manager took back their readiness: at least two weeks from then.
  if (lastReset) due = { dueOn: later(due, grace(londonDate(lastReset))).dueOn, why: "reset", whyOn: londonDate(lastReset) };
  const q = newQuiz(cutoff, readyAt);
  if (q && (!due.whyOn || q.whyOn! >= due.whyOn)) due = { dueOn: later(due, q).dueOn, why: "quiz", whyOn: q.whyOn };
  if (readyAt) return finish(base("ready", { readyAt, ...due }));
  return finish(base(attemptsSince(cutoff).length ? "in_training" : "not_started", due));
}

/**
 * In words, for a list: "Done 12 Oct 2026", "Done 12 Oct 2026 · refresher by 12 Oct 2027", "Due by 19 Oct 2026",
 * "Overdue since 19 Oct 2026", "Waiting for a manager since 14 Oct 2026".
 */
export function progressText(p: Progress, today: string): string {
  if (p.state === "done") {
    const done = `Done ${dayMonthYear(londonDate(p.doneAt!))}`;
    if (!p.dueOn) return done;
    const left = daysBetween(today, p.dueOn);
    return left <= REFRESHER_SOON_DAYS ? `${done} · refresher due ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`}` : `${done} · refresher by ${dayMonthYear(p.dueOn)}`;
  }
  if (p.state === "ready" && p.readyAt) return `Waiting for a manager since ${dayMonthYear(londonDate(p.readyAt))}`;
  if (!p.dueOn) return STATE_TEXT[p.state];
  return p.overdue ? `Overdue since ${dayMonthYear(p.dueOn)}` : `Due by ${dayMonthYear(p.dueOn)}`;
}

/** Why it has to be done again, in words. */
export const WHY_TEXT: Record<NonNullable<Progress["why"]>, string> = {
  expired: "Its refresher has fallen due",
  changed: "An SOP or recipe it covers has had a major change",
  reset: "A manager asked for it to be done again",
  quiz: "It now has a quiz: pass it, then a manager watches you do it",
};

/**
 * The latest major change among the SOPs and recipes a skill links to, if it came after the document was linked
 * (linking one accepts it as it is).
 */
export function changedAt(skill: Pick<Skill, "links" | "linkedAt">, majorChanges: Map<string, number>): number | undefined {
  const times = skill.links.map((id) => majorChanges.get(id)).filter((t, i): t is number => t !== undefined && t > (skill.linkedAt[skill.links[i]] ?? 0));
  return times.length ? Math.max(...times) : undefined;
}

/** When a skill's quiz started being asked: its earliest approved question. */
export function quizSince(skillId: string, questions: Pick<Question, "skillId" | "approved" | "approvedAt">[]): number | undefined {
  const times = questions.filter((q) => q.skillId === skillId && q.approved && q.approvedAt).map((q) => q.approvedAt!);
  return times.length ? Math.min(...times) : undefined;
}

/** The questions asked in a skill's quiz: approved ones, in order. */
export const quizOf = (skillId: string, questions: Question[]) =>
  questions.filter((q) => q.skillId === skillId && q.approved).sort((a, b) => a.position - b.position);

/** Which version of a quiz someone was shown: it changes when a question is added, changed, approved or taken off. */
export const quizVersion = (quiz: Pick<Question, "id" | "updatedAt">[]) => quiz.map((q) => `${q.id}@${q.updatedAt}`).join(",");

/**
 * Whether a manager may confirm a hands-on skill now: it isn't done (or its refresher is coming up), and the quiz, if
 * it has one, has been passed since it last had to be done (or since its refresher opened).
 */
export function canConfirmNow(skill: Pick<Skill, "handsOn">, p: Progress, hasQuiz: boolean): Checked {
  if (!skill.handsOn) return no("This one is done by passing the quiz");
  if (p.state === "done" && !p.renewal) return no("It's already done");
  if (hasQuiz && !p.readyAt) return no(p.state === "done" ? "They need to pass the quiz again first" : "They need to pass the quiz first");
  return yes;
}

/**
 * Whether someone may mark a skill with no quiz done themselves (knowledge), or say they're ready to be checked
 * (hands-on). Not while its quiz is being written (drafted questions), for a knowledge skill: it'll be done by the quiz.
 */
export function canMarkDone(skill: Pick<Skill, "handsOn">, p: Progress, quiz: { asked: boolean; drafted: boolean }): Checked {
  if (quiz.asked) return no("Pass the quiz to finish this one");
  if (!skill.handsOn && quiz.drafted) return no("Its quiz is being written: you'll take it once it's ready");
  if (p.readyAt) return no("It's waiting for a manager to check you");
  if (p.state === "done" && !p.renewal) return no("It's already done");
  return yes;
}

/** Whether there's something to take back: it's done, or it's ready to be checked. */
export function canTakeBackNow(p: Progress): Checked {
  return p.state === "done" || p.state === "ready" ? yes : no("There's nothing to take back");
}

// ---------- quizzes ----------

export interface QuizResult { total: number; correct: number; score: number; passed: boolean; wrong: string[] }

/**
 * Marks a quiz. `answers` maps each question to the option picked (its index as stored). Every question must be
 * answered. Passing is exact: at least the pass mark's share of questions right (no rounding up).
 */
export function gradeQuiz(questions: Pick<Question, "id" | "answer">[], answers: Record<string, number>, passMark: number): Cleaned<QuizResult> {
  if (!questions.length) return { ok: false, error: "This skill has no quiz yet" };
  const left = questions.filter((q) => !Number.isInteger(answers[q.id]));
  if (left.length) return { ok: false, error: left.length === 1 ? "Answer the last question" : `Answer every question (${left.length} left)` };
  const wrong = questions.filter((q) => answers[q.id] !== q.answer).map((q) => q.id);
  const total = questions.length, correct = total - wrong.length;
  return { ok: true, value: { total, correct, score: Math.round((100 * correct) / total), passed: correct * 100 >= passMark * total, wrong } };
}

/** A fair shuffle driven by `rand` (so tests can fix it). */
export function shuffled<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- what the editors send ----------

export interface SkillInput {
  section: string; group: string; title: string; about: string; handsOn: boolean; induction: boolean;
  links: string[]; videoUrl: string; refresherMonths: number | null; passMark: number;
}
export type SkillFields = Pick<Skill, "section" | "group" | "title" | "about" | "handsOn" | "induction" | "links" | "videoUrl" | "refresherMonths" | "passMark">;

/** A video link: https only, so it opens safely on any phone. */
export function cleanVideoUrl(raw: string): Cleaned<string | undefined> {
  const t = raw.trim();
  if (!t) return { ok: true, value: undefined };
  if (t.length > TRAINING_LIMITS.url) return { ok: false, error: "That link is too long" };
  let u: URL;
  try { u = new URL(t); } catch { return { ok: false, error: "Paste the video's full link, starting https://" }; }
  if (u.protocol !== "https:" || !u.hostname.includes(".")) return { ok: false, error: "Paste the video's full link, starting https://" };
  return { ok: true, value: u.toString() };
}

export function cleanSkill(input: SkillInput): Cleaned<SkillFields> {
  if (!PATHWAYS.includes(input.section as Area)) return { ok: false, error: "Choose the pathway" };
  const title = oneLine(input.title), group = oneLine(input.group), about = cleanText(input.about);
  if (!title) return { ok: false, error: "Give the skill a name" };
  if (title.length > TRAINING_LIMITS.title) return { ok: false, error: `Keep the name under ${TRAINING_LIMITS.title} characters` };
  if (!group) return { ok: false, error: "Say which heading it goes under (Operations, Service…)" };
  if (group.length > TRAINING_LIMITS.group) return { ok: false, error: `Keep the heading under ${TRAINING_LIMITS.group} characters` };
  if (about.length > TRAINING_LIMITS.about) return { ok: false, error: `Keep "what it covers" under ${TRAINING_LIMITS.about} characters` };
  const links = Array.from(new Set(input.links.map((l) => l.toLowerCase())));
  if (links.some((l) => !UUID.test(l))) return { ok: false, error: "One of the links isn't an SOP or recipe" };
  if (links.length > TRAINING_LIMITS.links) return { ok: false, error: `Link at most ${TRAINING_LIMITS.links} SOPs and recipes` };
  const video = cleanVideoUrl(input.videoUrl);
  if (!video.ok) return video;
  const r = input.refresherMonths;
  if (r !== null && (!Number.isInteger(r) || r < 1 || r > TRAINING_LIMITS.refresherMonths)) return { ok: false, error: `A refresher is every 1 to ${TRAINING_LIMITS.refresherMonths} months` };
  if (!Number.isInteger(input.passMark) || input.passMark < 50 || input.passMark > 100) return { ok: false, error: "The pass mark is between 50% and 100%" };
  return {
    ok: true,
    value: {
      section: input.section as Area, group, title, about, handsOn: !!input.handsOn, induction: !!input.induction, links,
      ...(video.value ? { videoUrl: video.value } : {}), ...(r !== null ? { refresherMonths: r } : {}), passMark: input.passMark,
    },
  };
}

export interface QuestionInput { text: string; options: string[]; answer: number }

/** A question: its words, 2 to 6 different answers (blank ones dropped) and which one is right. */
export function cleanQuestion(input: QuestionInput): Cleaned<{ text: string; options: string[]; answer: number }> {
  const text = oneLine(input.text);
  if (!text) return { ok: false, error: "Write the question" };
  if (text.length > TRAINING_LIMITS.question) return { ok: false, error: `Keep the question under ${TRAINING_LIMITS.question} characters` };
  const kept = input.options.map((o, i) => ({ text: oneLine(o), i })).filter((o) => o.text);
  if (kept.length < 2) return { ok: false, error: "Give at least two answers to choose from" };
  if (kept.length > TRAINING_LIMITS.options) return { ok: false, error: `At most ${TRAINING_LIMITS.options} answers` };
  if (kept.some((o) => o.text.length > TRAINING_LIMITS.option)) return { ok: false, error: `Keep each answer under ${TRAINING_LIMITS.option} characters` };
  if (new Set(kept.map((o) => o.text.toLowerCase())).size !== kept.length) return { ok: false, error: "Two answers are the same" };
  const answer = kept.findIndex((o) => o.i === input.answer);
  if (answer < 0) return { ok: false, error: "Choose which answer is right" };
  return { ok: true, value: { text, options: kept.map((o) => o.text), answer } };
}

export function cleanPathway(input: { inductionDays: number; allDays: number }): Cleaned<{ inductionDays: number; allDays: number }> {
  const { inductionDays: i, allDays: a } = input;
  if (!Number.isInteger(i) || i < 1 || i > 60) return { ok: false, error: "Induction: between 1 and 60 days" };
  if (!Number.isInteger(a) || a < 1 || a > 365) return { ok: false, error: "Everything: between 1 and 365 days" };
  if (i > a) return { ok: false, error: "Induction can't take longer than everything" };
  return { ok: true, value: { inductionDays: i, allDays: a } };
}

// ---------- for managers and messages ----------

export interface TrainingData {
  skills: Skill[];
  questions: Question[];
  events: TrainingEvent[];
  starts: TrainingStart[];
  pathways: Pathway[];
  majorChanges: Map<string, number>;
}

export interface PassportRow {
  skill: Skill;
  progress: Progress;
  /** Its quiz has approved questions: it's asked now. */
  hasQuiz: boolean;
  /** It has drafted questions waiting to be approved. */
  drafted: boolean;
}

export const pathwayOf = (pathways: Pathway[], section: Area): Pathway =>
  pathways.find((p) => p.section === section) ?? { section, ...DEFAULT_PATHWAY };

/** The day someone last (re)started training in a section: they start again after leaving or a site closure. */
export const startedOn = (starts: TrainingStart[], personId: string, section: Area): string | undefined =>
  starts.filter((s) => s.personId === personId && s.section === section).map((s) => s.startedOn).sort().at(-1);

/**
 * Starts to record today: each section someone trains in with no start yet (everyone, the first time the scheduler
 * runs after training goes live; afterwards the stores record starts as people are given sections or come back).
 */
export function missingStarts(people: Pick<Person, "id" | "status" | "access">[], sites: Pick<Site, "id" | "status">[], starts: TrainingStart[], today: string): TrainingStart[] {
  const has = new Set(starts.map((s) => `${s.personId}|${s.section}`));
  return people.flatMap((p) => trainingSections(p, sites).filter((sec) => !has.has(`${p.id}|${sec}`)).map((section) => ({ personId: p.id, section, startedOn: today })));
}

/** Someone's passport: each of their skills, in order, with where they stand. */
export function passport(p: Pick<Person, "id" | "status" | "access">, sites: Pick<Site, "id" | "status">[], d: TrainingData, today: string): PassportRow[] {
  const asked = new Set(d.questions.filter((q) => q.approved).map((q) => q.skillId));
  const drafted = new Set(d.questions.filter((q) => !q.approved).map((q) => q.skillId));
  const mine = d.events.filter((e) => e.personId === p.id);
  return skillsFor(p, sites, d.skills).map((skill) => {
    const hasQuiz = asked.has(skill.id);
    return {
      skill, hasQuiz, drafted: drafted.has(skill.id),
      progress: progress(skill, {
        // No start recorded yet (the scheduler records it within minutes): as if they start today.
        events: mine.filter((e) => e.skillId === skill.id), startedOn: startedOn(d.starts, p.id, skill.section) ?? today,
        pathway: pathwayOf(d.pathways, skill.section), changedAt: changedAt(skill, d.majorChanges), hasQuiz, quizSince: quizSince(skill.id, d.questions), today,
      }),
    };
  });
}

/**
 * How a passport adds up. `ready`: waiting for a manager to check them (a refresher being renewed too); `again`: to do
 * again (their move: a refresher fallen due, a changed SOP or recipe, or a manager asking).
 */
export function tally(rows: PassportRow[]): { total: number; done: number; overdue: number; ready: number; again: number } {
  return {
    total: rows.length,
    done: rows.filter((r) => r.progress.state === "done").length,
    overdue: rows.filter((r) => r.progress.overdue).length,
    ready: rows.filter((r) => !!r.progress.readyAt).length,
    again: rows.filter((r) => r.progress.state === "refresher" || (!!r.progress.why && (r.progress.state === "not_started" || r.progress.state === "in_training"))).length,
  };
}

/**
 * What's waiting for someone in training: hands-on skills they can confirm now (the person has passed the quiz or said
 * they're ready), people (whose training they look after) with something overdue, and for the owner and operations
 * managers, skills with drafted questions to approve.
 */
export function trainingToDo(actor: Pick<Person, "id" | "status" | "access">, people: Pick<Person, "id" | "status" | "access">[],
  sites: Pick<Site, "id" | "status">[], d: TrainingData, today: string): { ready: number; overdue: number; toApprove: number } {
  let ready = 0, overdue = 0;
  for (const p of people) {
    if (p.id === actor.id) continue;
    const rows = passport(p, sites, d, today).filter((r) => managesTraining(actor, p, r.skill.section, sites).ok);
    ready += rows.filter((r) => !!r.progress.readyAt && canConfirmNow(r.skill, r.progress, r.hasQuiz).ok).length;
    if (rows.some((r) => r.progress.overdue)) overdue++;
  }
  const live = new Set(d.skills.filter((s) => !s.retiredAt).map((s) => s.id));
  const toApprove = canEditTraining(actor) ? new Set(d.questions.filter((q) => !q.approved && live.has(q.skillId)).map((q) => q.skillId)).size : 0;
  return { ready, overdue, toApprove };
}

export interface TrainingMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }

const AGAIN_TEXT: Record<NonNullable<Progress["why"]>, string> = {
  expired: "Its refresher has fallen due",
  changed: "An SOP or recipe it covers has changed",
  reset: "Your manager asked for it to be done again",
  quiz: "It now has a quiz to pass before a manager checks you",
};

/**
 * The reminders due today, to the person: a refresher coming up (30 days before), a refresher due, or a skill to do
 * again (an SOP or recipe it covers changed, a manager asked, or a change to the skill gave them until a date). Each
 * has its own key, so it's sent once; old dates are skipped, so loading past records doesn't send a flood. Nothing
 * while a skill is waiting for a manager's check.
 */
export function trainingReminders(people: Pick<Person, "id" | "status" | "access">[], sites: Pick<Site, "id" | "status">[], d: TrainingData, today: string): TrainingMessage[] {
  const out: TrainingMessage[] = [];
  const recent = (date: string) => date <= today && date >= addDays(today, -TRAINING_REMINDER_DAYS);
  for (const p of people) {
    for (const { skill, progress: pr } of passport(p, sites, d, today)) {
      const url = `/library/training/${skill.id}`;
      const key = (stage: string) => `training|${p.id}|${skill.id}|${stage}`;
      if (pr.readyAt || !pr.dueOn) continue;
      if (pr.state === "done") {
        if (pr.renewal) out.push({ personId: p.id, title: `Refresher coming up: ${skill.title}`, body: `Do it again by ${dayMonthYear(pr.dueOn)} to keep it in date. Open it in Library → Training.`, dedupeKey: key(`soon|${pr.dueOn}`), url });
      } else if (pr.why === "expired" && pr.dueOn <= today) {
        if (recent(pr.dueOn)) out.push({ personId: p.id, title: `Refresher due: ${skill.title}`, body: `It was due on ${dayMonthYear(pr.dueOn)}. Open it in Library → Training to do it again.`, dedupeKey: key(`due|${pr.dueOn}`), url });
      } else if (pr.why && pr.whyOn && recent(pr.whyOn)) {
        out.push({ personId: p.id, title: `${pr.why === "quiz" ? "New quiz" : "Do it again"}: ${skill.title}`, body: `${AGAIN_TEXT[pr.why]}. Please do it by ${dayMonthYear(pr.dueOn)}.`, dedupeKey: key(`again|${pr.whyOn}`), url });
      }
    }
  }
  return out;
}
