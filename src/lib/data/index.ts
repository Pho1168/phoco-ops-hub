import type { Store } from "./store";
import { demoStore } from "./demo-store";
import { sqlStore } from "./sql-store";

/** Demo mode (sample data in memory) unless the server has a DATABASE_URL. */
export const DEMO_MODE = !process.env.DATABASE_URL;

export function store(): Store {
  return DEMO_MODE ? demoStore : sqlStore;
}
