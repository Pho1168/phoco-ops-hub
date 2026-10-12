import { isOwner } from "./access";
import { canSeeRightToWork, certType } from "./certificates";
import type { Person, SiteId } from "./types";

/** An activity log line, as the overview shows it. */
export interface ActivityEntry { actorId?: string; siteId?: string; action: string; detail: string }

/** Certificate lines about right to work ("Right to work check recorded for ..."). */
const isRightToWork = (e: ActivityEntry) => e.action.startsWith("cert.") && e.detail.includes(certType("right_to_work").label);

/**
 * The activity a viewer sees on the overview. Owners see everything. An operations manager sees what happened at
 * the sites they run and what they did themselves, but never right to work checks unless they may see them.
 */
export function activityFor<E extends ActivityEntry>(viewer: Pick<Person, "id" | "access" | "status" | "seesRightToWork">, entries: E[], sites: SiteId[]): E[] {
  if (isOwner(viewer)) return entries;
  const rtw = canSeeRightToWork(viewer);
  return entries.filter((e) => (e.actorId === viewer.id || (!!e.siteId && sites.includes(e.siteId as SiteId))) && (rtw || !isRightToWork(e)));
}
