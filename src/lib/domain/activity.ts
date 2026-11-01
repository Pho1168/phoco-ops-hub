import { isOwner } from "./access";
import { canSeeRightToWork, certType } from "./certificates";
import type { Person, SiteId } from "./types";

/** An activity log line, as the overview shows it. */
export interface ActivityEntry { actorId?: string; siteId?: string; action: string; detail: string }

/** Certificate lines about right to work ("Right to work check recorded for ..."). */
const isRightToWork = (e: ActivityEntry) => e.action.startsWith("cert.") && e.detail.includes(certType("right_to_work").label);

/**
 * The activity a viewer sees on the overview. Owners see everything at every site; an operations manager what
 * happened at the sites they run and what they did themselves. Right to work checks show only to someone who may see
 * them (`canSeeRightToWork`: being an owner isn't enough).
 */
export function activityFor<E extends ActivityEntry>(viewer: Pick<Person, "id" | "access" | "status" | "seesRightToWork">, entries: E[], sites: SiteId[]): E[] {
  const rtw = canSeeRightToWork(viewer);
  return entries.filter((e) => (isOwner(viewer) || e.actorId === viewer.id || (!!e.siteId && sites.includes(e.siteId as SiteId))) && (rtw || !isRightToWork(e)));
}
