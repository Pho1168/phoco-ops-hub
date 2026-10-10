import { store, DEMO_MODE } from "@/lib/data";
import { DEMO_PINS } from "@/lib/data/demo-store";
import { currentDevice } from "@/lib/device";
import { LoginForm } from "./LoginForm";
import { SetupScreen } from "./SetupScreen";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const db = store();
  const device = await currentDevice();

  // Not a registered (active) tablet: no names are shown. Owners sign in with staff ID; tablets pair with a code.
  if (!DEMO_MODE && (!device || device.status !== "active")) {
    return <SetupScreen removed={device?.status === "locked"} />;
  }

  const allSites = (await db.sites()).filter((s) => s.id !== "SYD" || s.status === "open");
  const sites = device ? allSites.filter((s) => s.id === device.siteId) : allSites;
  const people = (await db.people())
    .filter((p) => p.status !== "left" && (!device || p.access.some((a) => a.siteId === device.siteId)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      frozen: p.status === "frozen",
      sites: p.access.map((a) => a.siteId),
      label: p.access.some((a) => a.role === "owner") ? "Owner · all sites" : Array.from(new Set(p.access.flatMap((a) => a.sections))).join(" · "),
    }));
  return (
    <>
      {DEMO_MODE && <div className="banner">Demo mode with sample data · PINs: owner {DEMO_PINS.owner} · everyone else {DEMO_PINS.staff}</div>}
      <LoginForm deviceLabel={device?.label}
        sites={sites.map((s) => ({ id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason }))} people={people} />
    </>
  );
}
