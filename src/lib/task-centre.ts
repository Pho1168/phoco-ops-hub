import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { canSeeRightToWork, certStatus, expectedKinds, statusText, visibleTypes } from "@/lib/domain/certificates";
import { faultsOf, keepsFoodSafe, serviceState } from "@/lib/domain/equipment";
import { datesBetween, signoffLog } from "@/lib/domain/records";
import { taskCentre, type CentreItem } from "@/lib/domain/tasks";
import { londonDate } from "@/lib/domain/time";
import type { Person, Site } from "@/lib/domain/types";

/**
 * Gathers everything open at one site for the task centre: manual tasks, alerts, kit, handover actions, prep,
 * overdue checklists, time off, certificates and servicing. Read-only: the rules are in `taskCentre`.
 */
export async function centreFor(site: Site, viewer: Pick<Person, "access" | "status" | "seesRightToWork">, now = Date.now(), db: Store = store()): Promise<CentreItem[]> {
  const today = londonDate(now);
  const seesRtw = canSeeRightToWork(viewer);
  const [tasks, alerts, kit, kitEvents, notes, prepOn, records, pendingLeave, people, certs] = await Promise.all([
    db.tasks({ siteIds: [site.id] }),
    db.alerts(site.id),
    db.equipment(site.id),
    db.equipmentEvents({ siteId: site.id }),
    db.handover(site.id),
    db.prepEnabledSites().then((s) => s.includes(site.id)),
    db.recordsData(site.id, today, today),
    db.timeOff({ siteIds: [site.id], statuses: ["pending"] }),
    db.people(),
    db.certificates(),
  ]);
  const prep = prepOn ? await db.prepOutstanding(site.id) : [];

  const kitItems = kit.flatMap((eq) => {
    const open = faultsOf(kitEvents.filter((e) => e.equipmentId === eq.id)).filter((f) => !f.fixed);
    if (!open.length) return [];
    const down = open.filter((f) => f.fault.severity === "down");
    const main = (down.length ? down : open)[0];
    return [{ id: eq.id, name: eq.name, foodSafety: keepsFoodSafe(eq.kind), down: down.length > 0, problems: open.length, since: Math.min(...open.map((f) => f.fault.createdAt)), latest: main.fault.body }];
  });

  const here = people.filter((p) => p.status === "active" && p.access.some((a) => a.siteId === site.id));
  const types = visibleTypes(seesRtw);
  const expired: { personId: string; name: string; label: string }[] = [];
  const expiring: { personId: string; name: string; label: string; text: string }[] = [];
  let missing = 0;
  for (const p of here) {
    const expected = new Set(expectedKinds(p));
    const mine = certs.filter((c) => c.personId === p.id);
    for (const t of types) {
      const st = certStatus(mine, t.id, expected.has(t.id), today);
      if (st.status === "expired") expired.push({ personId: p.id, name: p.name, label: t.label });
      else if (st.status === "expiring") expiring.push({ personId: p.id, name: p.name, label: t.label, text: statusText(t.id, st, today) });
      else if (st.status === "missing") missing++;
    }
  }

  return taskCentre({
    siteId: site.id, today,
    tasks,
    alerts: alerts.filter((a) => !a.resolvedAt),
    kit: kitItems,
    handoverActions: notes.filter((n) => n.needsAction && !n.closedAt),
    prepOutstanding: { urgent: prep.filter((e) => e.urgent).length, total: prep.length, since: prep.length ? Math.min(...prep.map((e) => e.createdAt)) : undefined },
    checklistsOverdue: signoffLog(records.lists, records.runs, datesBetween(today, today), now, records.trackingFrom)
      .filter((r) => r.status === "not_signed").map((r) => ({ id: r.listId, name: r.listName, due: r.due })),
    timeOffPending: pendingLeave.length,
    certificates: { expired, expiring, missing },
    services: kit.flatMap((eq) => {
      const s = serviceState(eq, kitEvents.filter((e) => e.equipmentId === eq.id), today);
      return s.status === "overdue" || s.status === "soon" ? [{ id: eq.id, name: eq.name, overdue: s.status === "overdue", due: s.due! }] : [];
    }),
  });
}
