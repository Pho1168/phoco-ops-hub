import { store, DEMO_MODE } from "@/lib/data";
import { DEMO_PINS } from "@/lib/data/demo-store";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const db = store();
  const sites = (await db.sites()).filter((s) => s.id !== "SYD" || s.status === "open");
  const people = (await db.people()).filter((p) => p.status !== "left").map((p) => ({
    id: p.id,
    name: p.name,
    frozen: p.status === "frozen",
    sites: p.access.map((a) => a.siteId),
    label: p.access.some((a) => a.role === "owner") ? "Owner · all sites" : Array.from(new Set(p.access.flatMap((a) => a.sections))).join(" · "),
  }));
  return (
    <>
      {DEMO_MODE && <div className="banner">Demo mode with sample data · PINs: owner {DEMO_PINS.owner} · everyone else {DEMO_PINS.staff}</div>}
      <LoginForm sites={sites.map((s) => ({ id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason }))} people={people} />
    </>
  );
}
