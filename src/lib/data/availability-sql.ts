import type postgres from "postgres";
import type { AvailDay, Availability } from "@/lib/domain/availability";
import { sql } from "./pg";
import type { AvailabilityStore } from "./availability-store";

/** Postgres implementation of weekly availability (migration 0044). */
interface Row { id: string; person_id: string; person_name: string | null; week: string; days: AvailDay[]; created_at: Date }
const toAvail = (r: Row): Availability => ({ id: r.id, personId: r.person_id, personName: r.person_name ?? undefined, week: r.week, days: r.days, createdAt: r.created_at.getTime() });
const select = (q: ReturnType<typeof sql>) => q`select a.id, a.person_id, p.display_name as person_name, to_char(a.week, 'YYYY-MM-DD') as week, a.days, a.created_at
  from availability a left join people p on p.id = a.person_id`;

export const availabilitySql: AvailabilityStore = {
  async availability(week) {
    const q = sql();
    return (await q<Row[]>`${select(q)} where a.week = ${week} order by a.created_at, a.id`).map(toAvail);
  },
  async myAvailability(personId, weeks) {
    const q = sql();
    return (await q<Row[]>`${select(q)} where a.person_id = ${personId} and a.week = any(${weeks}::date[]) order by a.created_at, a.id`).map(toAvail);
  },
  async addAvailability(personId, week, days) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`insert into availability (person_id, week, days) values (${personId}, ${week}, ${q.json(days as unknown as postgres.JSONValue)}) returning id`;
    const [row] = await q<Row[]>`${select(q)} where a.id = ${r.id}`;
    return toAvail(row);
  },
};
