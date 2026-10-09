import type { Store } from "./store";
import { demoStore } from "./demo-store";

/** Demo mode until Supabase is connected (SUPABASE_URL set on the server). */
export const DEMO_MODE = !process.env.SUPABASE_URL;

export function store(): Store {
  if (!DEMO_MODE) throw new Error("Supabase store not connected yet. Remove SUPABASE_URL to run in demo mode.");
  return demoStore;
}
