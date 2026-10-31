import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { isOwner, leadSites } from "@/lib/domain/access";
import { sectionsFor } from "@/lib/domain/staff";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { pickSite } from "../load";
import { CleaningEditor } from "./CleaningEditor";

export const dynamic = "force-dynamic";

/**
 * The weekly cleaning board's jobs, as the owner keeps them: a table per site to add, change, take off and put back.
 * Jobs are never deleted (their history stays); taking one off removes it from the board and its reminders.
 */
export default async function CleaningJobs(props: { searchParams: Promise<{ site?: string }> }) {
  const { site: wanted } = await props.searchParams;
  const ctx = await requireCtx();
  if (!isOwner(ctx.person)) redirect("/shift");
  const db = store();
  const all = await db.sites();
  const { sites, site } = await pickSite(leadSites(ctx.person, all.map((s) => s.id)), wanted, ctx.site.id);
  const jobs = await db.cleaningJobs([site.id]);
  return (
    <>
      <TopBar ctx={ctx} neutral title="Cleaning jobs" eyebrow={`Owner · ${site.name}`} back="/owner" />
      <main className="wide stack">
        {sites.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/manage/cleaning?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}
        <p className="muted" style={{ margin: 0 }}>The jobs on {site.name}&apos;s weekly cleaning board: done a few times a week or a month on no set day, or every few months. Take a job off to remove it from the board and its reminders; its history is kept and you can put it back.</p>
        <CleaningEditor siteId={site.id} siteName={site.name} areas={sectionsFor(site.kind)}
          jobs={jobs.map((j) => ({ id: j.id, name: j.name, area: j.area, per: j.per, times: j.times, everyMonths: j.everyMonths, firstDue: j.firstDue, active: j.active }))} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
