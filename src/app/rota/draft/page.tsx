import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { addDays, isIsoDate, londonDate, shortDay } from "@/lib/domain/time";
import { weekStartOf } from "@/lib/domain/rota";
import { sameBusiness } from "@/lib/domain/brand";
import { rotaDraftView } from "@/lib/rota-draft-service";
import { DraftClient } from "./DraftClient";

export const dynamic = "force-dynamic";

/**
 * The owner drafts a coming week's rota for one site: last published week's shape, filled from who said they can work,
 * with the weekend minimum topped up. A scratchpad to read, swap and type into the rota sheet; nothing is saved and
 * the app never writes to the sheet. Owner only.
 */
export default async function RotaDraft(props: { searchParams: Promise<{ week?: string; site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/rota");
  const db = store();
  const sites = sameBusiness((await db.sites()).filter((s) => s.status === "open"), ctx.site);
  const site = sites.find((s) => s.id === searchParams.site) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  if (!site) redirect("/rota");
  const thisWeek = weekStartOf(londonDate(Date.now()));
  const week = isIsoDate(searchParams.week) ? weekStartOf(searchParams.week) : addDays(thisWeek, 7);
  const view = await rotaDraftView(db, site, week);
  const back = `/rota?week=${week}${site.id !== ctx.site.id ? `&site=${site.id}` : ""}`;
  return (
    <>
      <TopBar ctx={ctx} title="Draft rota" eyebrow={`${site.name} · week of ${shortDay(week)}`} back={back} />
      <main>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn ghost small" href={`/rota/draft?week=${addDays(week, -7)}&site=${site.id}`}>← Previous</Link>
          <Link className="btn ghost small" href={`/rota/draft?week=${addDays(week, 7)}&site=${site.id}`}>Next →</Link>
          <span className="grow" />
          {sites.length > 1 && (
            <nav className="row" style={{ gap: 6 }} aria-label="Site">
              {sites.map((s) => <Link key={s.id} className={`btn small ${s.id === site.id ? "" : "ghost"}`} href={`/rota/draft?week=${week}&site=${s.id}`}>{s.name}</Link>)}
            </nav>
          )}
        </div>
        <p className="muted lead" style={{ margin: "10px 0 0" }}>
          {view.template
            ? <>Last published week (<strong>{shortDay(view.template)}</strong>) copied onto this one and filled from the availability people sent. Swap anyone, then type it into the rota sheet. Nothing here is saved.</>
            : <>No published week to copy yet at {site.name}. Publish one week in the sheet first, and the draft takes its shape.</>}
        </p>
        {view.template && <DraftClient serial={view.input} siteName={site.name} />}
      </main>
      <BottomNav ctx={ctx} current="rota" />
    </>
  );
}

