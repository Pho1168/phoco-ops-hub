import { store } from "@/lib/data";
import { isLive } from "@/lib/domain/notices";
import { londonDate } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";
import type { ManageCounts } from "./ManageTiles";

/** Numbers shown on the manager tiles. */
export async function manageCounts(managed: SiteId[]): Promise<ManageCounts> {
  const db = store();
  const today = londonDate(Date.now());
  const notices = await db.teamNotices(0);
  return {
    noticesActive: notices.filter((n) => isLive(n, today) && (!n.siteId || managed.includes(n.siteId))).length,
  };
}
