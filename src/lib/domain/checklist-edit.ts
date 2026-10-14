import type { AnswerType, Area, ChecklistItem, Person, TempRule } from "./types";
import { isOwner } from "./access";

/**
 * Editing the operational checklists (opening, closing, cleans, temperature logs) in the app.
 *
 * A checklist is a template (name, area, when it's done, due time, on or off) plus numbered versions of its items.
 * Runs are signed against a version, so items are never changed in place: the owner edits a draft and publishes it
 * as the next version; the published one before it is retired. Settings (name, due time, on/off) aren't versioned:
 * they take effect at once. Only the owner edits.
 */

export const CHECKLIST_AREAS: Area[] = ["FOH", "BOH", "PROD"];
export const AREA_TEXT: Record<Area, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };

export const ANSWER_TYPES: { id: AnswerType; label: string; help: string }[] = [
  { id: "tick", label: "Tick", help: "Done or not done" },
  { id: "temp", label: "Temperature", help: "A reading in °C, checked against a limit" },
  { id: "number", label: "Number", help: "A count or a reading with no limit" },
  { id: "text", label: "Text", help: "A short note" },
  { id: "photo", label: "Photo", help: "A picture as proof" },
];
const TYPES = new Set<string>(ANSWER_TYPES.map((t) => t.id));

export const NAME_MAX = 60, WHEN_MAX = 60, SECTION_MAX = 40, TEXT_MAX = 200, HINT_MAX = 200, ITEMS_MAX = 150;

export type Checked = { ok: true } | { ok: false; error: string };
export type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };
const no = (error: string) => ({ ok: false as const, error });

export const canEditChecklists = (p: Pick<Person, "access">) => isOwner(p);

// ---------- settings ----------

export interface ChecklistSettings { name: string; area: Area; when: string; due?: string }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The template's own fields, as typed. `due` is "HH:MM" or empty (a checklist with no due time is never late). */
export function cleanSettings(input: { name?: unknown; area?: unknown; when?: unknown; due?: unknown }): Cleaned<ChecklistSettings> {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  const when = String(input.when ?? "").trim().replace(/\s+/g, " ");
  const due = String(input.due ?? "").trim();
  const area = String(input.area ?? "");
  if (name.length < 2) return no("Give the checklist a name");
  if (name.length > NAME_MAX) return no(`The name can be ${NAME_MAX} characters at most`);
  if (!CHECKLIST_AREAS.includes(area as Area)) return no("Pick who does it: front of house, back of house or production");
  if (when.length < 2) return no("Say when it's done, e.g. Before doors open");
  if (when.length > WHEN_MAX) return no(`"When" can be ${WHEN_MAX} characters at most`);
  if (due && !HM.test(due)) return no("The due time should be like 11:45, or left empty");
  return { ok: true, value: { name, area: area as Area, when, due: due || undefined } };
}

/** The id a new checklist gets: SITE-AREA-SLUG, like the seeded ones (EAS-FOH-OPEN), with a number if that's taken. */
export function templateId(siteId: string, area: Area, name: string, taken: string[]): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24).replace(/-$/, "") || "LIST";
  const base = `${siteId}-${area}-${slug}`;
  const have = new Set(taken.map((t) => t.toUpperCase()));
  if (!have.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!have.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

// ---------- items ----------

/** An item as the editor sends it: no id or position (those are given on save). */
export interface DraftItem { section: string; text: string; type: AnswerType; ruleCode?: string; hint?: string }

/** Items as typed: trimmed, renumbered, every temperature check tied to a limit from the HACCP plan. Empty rows are dropped. */
export function cleanItems(input: unknown, rules: Record<string, TempRule>): Cleaned<DraftItem[]> {
  if (!Array.isArray(input)) return no("Those items couldn't be read");
  const out: DraftItem[] = [];
  let section = "General";
  for (const [i, raw] of input.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const text = String(r.text ?? "").trim().replace(/\s+/g, " ");
    const sec = String(r.section ?? "").trim().replace(/\s+/g, " ");
    const type = String(r.type ?? "tick");
    const hint = String(r.hint ?? "").trim();
    const ruleCode = String(r.ruleCode ?? "").trim();
    if (sec) section = sec;
    if (!text && !hint) continue; // an empty row
    if (!text) return no(`Item ${i + 1} has a hint but no check`);
    if (text.length > TEXT_MAX) return no(`Item ${i + 1} is too long (${TEXT_MAX} characters at most)`);
    if (section.length > SECTION_MAX) return no(`The section name "${section.slice(0, 20)}…" is too long (${SECTION_MAX} characters at most)`);
    if (!TYPES.has(type)) return no(`Item ${i + 1}: pick what's recorded (tick, temperature, number, text or photo)`);
    if (hint.length > HINT_MAX) return no(`Item ${i + 1}: the hint is too long (${HINT_MAX} characters at most)`);
    if (type === "temp" && !rules[ruleCode]) return no(`Item ${i + 1}: a temperature check needs a limit from the HACCP plan`);
    out.push({ section, text, type: type as AnswerType, ruleCode: type === "temp" ? ruleCode : undefined, hint: hint || undefined });
  }
  if (out.length === 0) return no("Add at least one check");
  if (out.length > ITEMS_MAX) return no(`A checklist can have ${ITEMS_MAX} checks at most`);
  return { ok: true, value: out };
}

/** Published items as the editor starts from them (ids and positions dropped). */
export const toDraftItems = (items: ChecklistItem[]): DraftItem[] =>
  [...items].sort((a, b) => a.position - b.position).map((i) => ({ section: i.section, text: i.text, type: i.type, ruleCode: i.ruleCode, hint: i.hint }));

export const sameItems = (a: DraftItem[], b: DraftItem[]) =>
  a.length === b.length && a.every((x, i) => x.section === b[i].section && x.text === b[i].text && x.type === b[i].type && (x.ruleCode ?? "") === (b[i].ruleCode ?? "") && (x.hint ?? "") === (b[i].hint ?? ""));

/** What a new version changes, for the audit trail and the version note: counts, not a diff someone has to read. */
export function describeChange(before: DraftItem[] | undefined, after: DraftItem[]): string {
  if (!before) return `${after.length} check${after.length === 1 ? "" : "s"}`;
  const key = (i: DraftItem) => `${i.section}|${i.text}|${i.type}|${i.ruleCode ?? ""}|${i.hint ?? ""}`;
  const was = new Set(before.map(key)), now = new Set(after.map(key));
  const added = after.filter((i) => !was.has(key(i))).length;
  const removed = before.filter((i) => !now.has(key(i))).length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (!added && !removed && !sameItems(before, after)) parts.push("reordered");
  const n = `${after.length} check${after.length === 1 ? "" : "s"}`;
  return parts.length ? `${n}: ${parts.join(", ")}` : `${n}, unchanged`;
}

// ---------- publishing ----------

export interface RunToday { answers: number; signed: boolean }

/**
 * A new version can go live unless today's run of this checklist is half done: its answers belong to the version
 * it started on, so the owner waits for the sign-off (or publishes tomorrow). A signed run is closed, so that's fine.
 */
export function canPublish(items: DraftItem[], today: RunToday | undefined): Checked {
  if (items.length === 0) return no("Add at least one check before publishing");
  if (today && today.answers > 0 && !today.signed) return no("Today's run of this checklist has started. Publish once it's signed off, or tomorrow");
  return { ok: true };
}
