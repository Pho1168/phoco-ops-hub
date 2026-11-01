import type { Store } from "@/lib/data/store";
import { addDays } from "@/lib/domain/time";
import { latestAvailability, type AvailDay } from "@/lib/domain/availability";
import { draftRota, type BusyDay, type Draft, type DraftInput, type DraftPerson, type TemplateShift } from "@/lib/domain/rota-draft";
import type { Site, SiteId } from "@/lib/domain/types";
import { isOwner } from "@/lib/domain/access";

/** What the draft was built from, for the page to show and to work out swaps with. */
export interface DraftView {
  site: Site;
  week: string;
  /** The published week whose shape was copied (none: nothing to copy yet). */
  template?: string;
  input: Omit<DraftInput, "availability"> & { availability: [string, AvailDay[]][] };
  draft: Draft;
}

/** The most recent published week at the site before `week`, looking back a few months. */
async function lastPublished(db: Store, siteId: SiteId, week: string): Promise<string | undefined> {
  const statuses = await db.weekStatuses(siteId);
  const weeks = Array.from(statuses.entries()).filter(([w, st]) => st === "published" && w < week).map(([w]) => w).sort();
  return weeks.length ? weeks[weeks.length - 1] : undefined;
}

/**
 * Gathers what the owner's rota draft needs for a site and week: the last published week's shifts (its shape), the
 * active staff and managers there with their sections, their latest availability for the week, and the days they're
 * already taken (a shift at any other site, either business, published or not; approved time off). Nothing is written.
 */
export async function rotaDraftView(db: Store, site: Site, week: string): Promise<DraftView> {
  const [people, allSites, answers, leave] = await Promise.all([
    db.people(), db.sites(), db.availability(week), db.timeOff({ from: week, to: addDays(week, 6), statuses: ["approved"] }),
  ]);
  const staff: DraftPerson[] = people
    .filter((p) => p.status === "active" && !isOwner(p)) // owners aren't rota'd by the draft
    .flatMap((p) => { const a = p.access.find((x) => x.siteId === site.id); return a && (a.role === "staff" || a.role === "manager") && a.sections.length ? [{ id: p.id, name: p.name, sections: a.sections }] : []; })
    .sort((a, b) => a.name.localeCompare(b.name));
  const templateWeek = await lastPublished(db, site.id, week);
  const template: TemplateShift[] = templateWeek
    ? (await db.teamShifts(site.id, templateWeek)).map((s) => ({ personId: s.personId, section: s.section, date: s.date, start: s.start, end: s.end, hours: s.hours }))
    : [];
  const availability = latestAvailability(answers.filter((a) => a.week === week));
  const avail = new Map<string, AvailDay[]>();
  for (const p of staff) { const a = availability.get(p.id); if (a) avail.set(p.id, a.days); }
  // Busy days: shifts at other open sites that week (either business), and approved time off.
  const busy: BusyDay[] = [];
  for (const other of allSites.filter((s) => s.id !== site.id && s.status === "open")) {
    for (const s of await db.teamShifts(other.id, week)) {
      if (staff.some((p) => p.id === s.personId)) busy.push({ personId: s.personId, date: s.date, why: `${other.name} ${s.start}–${s.end}` });
    }
  }
  for (const t of leave) {
    if (!staff.some((p) => p.id === t.personId)) continue;
    for (let d = t.startsOn; d <= t.endsOn; d = addDays(d, 1)) if (d >= week && d <= addDays(week, 6)) busy.push({ personId: t.personId, date: d, why: "on approved time off" });
  }
  const input: DraftInput = { siteId: site.id, week, template, people: staff, availability: avail, busy };
  return { site, week, template: templateWeek, input: { ...input, availability: Array.from(avail.entries()) }, draft: draftRota(input) };
}
