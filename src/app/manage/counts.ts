import { store } from "@/lib/data";
import { isLive } from "@/lib/domain/notices";
import { canSeeRightToWork, issueCount, peopleInCare } from "@/lib/domain/certificates";
import { openFaults, serviceState } from "@/lib/domain/equipment";
import { centreFor } from "@/lib/task-centre";
import { londonDate } from "@/lib/domain/time";
import type { Person, SiteId } from "@/lib/domain/types";
import type { ManageCounts } from "./ManageTiles";

/** Numbers shown on the manager tiles. */
export async function manageCounts(actor: Pick<Person, "access" | "status" | "seesRightToWork">): Promise<ManageCounts> {
  const db = store();
  const today = londonDate(Date.now());
  const managed: SiteId[] = actor.access.filter((a) => a.role === "owner" || a.role === "manager").map((a) => a.siteId);
  const [notices, pending, people, certs, sites] = await Promise.all([
    db.teamNotices(0), db.timeOff({ siteIds: managed, statuses: ["pending"] }), db.people(), db.certificates(), db.sites(),
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
  return {
    urgent,
    timeOffPending: pending.length,
    noticesActive: notices.filter((n) => isLive(n, today) && (!n.siteId || managed.includes(n.siteId))).length,
    certIssues: issueCount(peopleInCare(actor, people), certs, today, canSeeRightToWork(actor), openManaged),
    equipmentIssues,
  };
}
