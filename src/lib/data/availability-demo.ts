import { randomUUID } from "node:crypto";
import type { Availability } from "@/lib/domain/availability";
import type { AvailabilityStore } from "./availability-store";

/** Weekly availability in demo mode: in memory, only ever added to. */
const g = globalThis as unknown as { __phocoAvailDemo?: Availability[] };
const S = () => (g.__phocoAvailDemo ??= []);
export function resetAvailabilityDemo() { g.__phocoAvailDemo = []; }

export function makeAvailabilityDemo(deps: { personName: (id: string) => string | undefined }): AvailabilityStore {
  const named = (x: Availability): Availability => ({ ...x, days: x.days.map((d) => ({ ...d })), personName: deps.personName(x.personId) });
  return {
    async availability(week) { return S().filter((x) => x.week === week).sort((a, b) => a.createdAt - b.createdAt).map(named); },
    async myAvailability(personId, weeks) { return S().filter((x) => x.personId === personId && weeks.includes(x.week)).sort((a, b) => a.createdAt - b.createdAt).map(named); },
    async addAvailability(personId, week, days) {
      const x: Availability = { id: randomUUID(), personId, week, days: days.map((d) => ({ ...d })), createdAt: Date.now() };
      S().push(x);
      return named(x);
    },
  };
}
