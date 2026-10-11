import type { SiteId } from "@/lib/domain/types";
import type { ManageCounts } from "./ManageTiles";

/** Numbers shown on the manager tiles. Each feature adds its count here. */
export async function manageCounts(managed: SiteId[]): Promise<ManageCounts> {
  void managed;
  return {};
}
