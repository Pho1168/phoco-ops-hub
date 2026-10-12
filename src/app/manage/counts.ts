import { store } from "@/lib/data";
import { isLive } from "@/lib/domain/notices";
import { canSeeRightToWork, issueCount, peopleInCare } from "@/lib/domain/certificates";
import { openFaults, serviceState } from "@/lib/domain/equipment";
import { centreFor } from "@/lib/task-centre";
import { coverState } from "@/lib/domain/cover";
import { londonDate } from "@/lib/domain/time";
import { managedSites } from "@/lib/domain/access";
import { canDecide } from "@/lib/domain/timeoff";
import { libraryToDo } from "@/lib/domain/library";
import type { Person } from "@/lib/domain/types";
import type { ManageCounts } from "./ManageTiles";

/** Numbers shown on the manager tiles. */
export async function manageCounts(actor: Pick<Person, "id" | "access" | "status" | "seesRightToWork">): Promise<ManageCounts> {
  const db = store();
  const today = londonDate(Date.now());
  const managed = managedSites(actor);
  const [notices, pending, people, certs, sites, sops] = await Promise.all([
    db.teamNotices(0), db.timeOff({ siteIds: managed, statuses: ["pending"] }), db.people(), db.certificates(), db.sites(), db.libraryDocs("sop"),
  ]);
  const openManaged = sites.filter((s) => s.status === "open" && managed.includes(s.id)).map((s) => s.id);
  let equipmentIssues = 0;
  for (const siteId of openManaged) {
    const [kit, events] = await Promise.all([db.equipment(siteId), db.equipmentEvents({ siteId })]);
    for (const eq of kit) {
      const mine = events.filter((e) => e.equipmentId === eq.id);
      equipmentIssues += openFaults(mine).length + (serviceState(eq, mine, today).status === "overdue" ? 1 : 0);
    }
  }
  const urgent = (await Promise.all(sites.filter((s) => openManaged.includes(s.id)).map((s) => centreFor(s, actor)))).flat().filter((i) => i.priority <= 2).length;
  // Cover: open requests with someone offering (to decide), and approved ones whose rota sheet still needs changing.
  const now = Date.now();
  const cover = openManaged.length ? await db.coverRequests({ siteIds: openManaged, live: true, shiftEndsAfter: now }) : [];
  const coverToDo = cover.filter((r) => { const st = coverState(r, now); return (st === "open" && r.offers.some((o) => !o.withdrawnAt)) || st === "approved"; }).length;
  // Time off to decide: only requests this person can decide (not their own; an operations manager's go to the owner).
  const byId = new Map(people.map((p) => [p.id, p]));
  const toDecide = pending.filter((t) => { const who = byId.get(t.personId); return !!who && canDecide(actor, t, who).ok; });
  return {
    urgent,
    timeOffPending: toDecide.length,
    noticesActive: notices.filter((n) => isLive(n, today) && (!n.siteId || managed.includes(n.siteId))).length,
    certIssues: issueCount(peopleInCare(actor, people), certs, today, canSeeRightToWork(actor), openManaged),
    equipmentIssues,
    coverToDo,
    libraryToDo: libraryToDo(actor, sops),
  };
}
