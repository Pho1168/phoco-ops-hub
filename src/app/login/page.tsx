import { store, DEMO_MODE } from "@/lib/data";
import { DEMO_PINS } from "@/lib/data/demo-store";
import { currentDevice } from "@/lib/device";
import { LoginForm } from "./LoginForm";
import { SetupScreen } from "./SetupScreen";
import { safeNextPath } from "@/lib/domain/equipment";
import { loginGroups, type LoginGroups, type LoginShift } from "@/lib/domain/login";
import { londonDate, longDay } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function LoginPage(props: { searchParams: Promise<{ next?: string; setup?: string }> }) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(searchParams.next);
  const db = store();
  const device = await currentDevice();
  const today = londonDate(Date.now());

  // Not a registered (active) tablet: no names are shown. People sign in with staff ID; tablets pair with a code.
  // (Demo mode has no devices; ?setup=1 shows that screen there so it can be looked at.)
  if (!DEMO_MODE ? !device || device.status !== "active" : searchParams.setup === "1") {
    return <SetupScreen removed={device?.status === "locked"} returnTo={next} />;
  }

  const allSites = (await db.sites()).filter((s) => s.id !== "SYD" || s.status === "open");
  const sites = device ? allSites.filter((s) => s.id === device.siteId) : allSites;
  const [people, rota] = await Promise.all([db.people(), db.shiftsOnDate(today)]);
  const shifts: LoginShift[] = rota.map((s) => ({ personId: s.personId, siteId: s.siteId, section: s.section, start: s.start, end: s.end }));
  // Who's listed, per site: today's rota first, then everyone else. Worked out here so no names leave the server unasked for.
  const groups = Object.fromEntries(sites.map((s) => [s.id, loginGroups(people, shifts, s.id)])) as Record<SiteId, LoginGroups>;
  return (
    <>
      {DEMO_MODE && <div className="banner">Demo mode with sample data · PINs: owner {DEMO_PINS.owner} · everyone else {DEMO_PINS.staff}</div>}
      <LoginForm deviceLabel={device?.label} returnTo={next} dateLine={longDay(today)}
        sites={sites.map((s) => ({ id: s.id, name: s.name, closed: s.status === "closed", reason: s.closedReason, brand: s.brand }))} groups={groups} />
    </>
  );
}
