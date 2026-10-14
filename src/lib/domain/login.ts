import { isOps, isOwner } from "./access";
import { laneName, laneOf, type Lane } from "./shift-mode";
import type { Person, SiteId } from "./types";

/** A published, not-cancelled shift on today's rota, as the sign-in screen needs it. */
export interface LoginShift { personId: string; siteId: SiteId; section: string; start: string; end: string }

/** The colour of someone's avatar: their lane, or "lead" for owners, ops and managers. */
export type Tone = Lane | "lead";

export interface LoginPerson {
  id: string;
  name: string;
  frozen: boolean;
  /** "Kitchen · 15:00–23:00" on the rota; "Manager · Front of house · Kitchen" otherwise. */
  label: string;
  tone: Tone;
  shift?: { start: string; end: string };
}

export interface LoginGroups {
  /** On today's rota at the site, earliest start first. */
  onToday: LoginPerson[];
  /** Everyone else with access at the site, by name; frozen people last. */
  others: LoginPerson[];
  /** The earliest start on today's rota, if anyone is on it. */
  firstIn?: string;
}

export function toneOf(p: Pick<Person, "access">, siteId: SiteId): Tone {
  if (isOwner(p) || isOps(p)) return "lead";
  const a = p.access.find((x) => x.siteId === siteId);
  if (a?.role === "manager") return "lead";
  return laneOf(a?.sections[0] ?? "", a?.sections) ?? "lead";
}

/** "Owner · all sites", "Operations manager", "Manager · Kitchen · Front of house", "Kitchen". */
export function roleLabel(p: Pick<Person, "access">, siteId: SiteId): string {
  if (isOwner(p)) return "Owner · all sites";
  if (isOps(p)) return "Operations manager";
  const a = p.access.find((x) => x.siteId === siteId);
  const sections = Array.from(new Set((a?.sections ?? []).map((s) => laneName(s))));
  const parts = a?.role === "manager" ? ["Manager", ...sections] : sections;
  return parts.join(" · ") || "Team";
}

/**
 * Who the sign-in screen lists at a site: people on today's rota first (earliest start first, with their lane and
 * times), then everyone else with access at the site by name, frozen accounts last. Someone with two shifts today
 * is shown once, with the first.
 */
export function loginGroups(people: Person[], shifts: LoginShift[], siteId: SiteId): LoginGroups {
  const here = people.filter((p) => p.status !== "left" && p.access.some((a) => a.siteId === siteId));
  const first = new Map<string, LoginShift>();
  for (const s of shifts.filter((s) => s.siteId === siteId)) {
    const prev = first.get(s.personId);
    if (!prev || s.start < prev.start) first.set(s.personId, s);
  }
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, "en-GB");
  const base = (p: Person): LoginPerson => ({ id: p.id, name: p.name, frozen: p.status === "frozen", label: p.status === "frozen" ? "Frozen" : roleLabel(p, siteId), tone: toneOf(p, siteId) });
  const onToday = here
    .filter((p) => first.has(p.id) && p.status === "active")
    .sort((a, b) => first.get(a.id)!.start.localeCompare(first.get(b.id)!.start) || byName(a, b))
    .map((p) => {
      const s = first.get(p.id)!;
      const lane = laneOf(s.section, p.access.find((a) => a.siteId === siteId)?.sections);
      return { ...base(p), label: `${lane ? laneName(lane) : s.section} · ${s.start}–${s.end}`, tone: toneOf(p, siteId) === "lead" ? "lead" : lane ?? base(p).tone, shift: { start: s.start, end: s.end } };
    });
  const others = here
    .filter((p) => !onToday.some((o) => o.id === p.id))
    .sort((a, b) => Number(a.status === "frozen") - Number(b.status === "frozen") || byName(a, b))
    .map(base);
  return { onToday, others, firstIn: onToday[0]?.shift?.start };
}
