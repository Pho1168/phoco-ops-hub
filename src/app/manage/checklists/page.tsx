import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { AREA_TEXT, canEditChecklists } from "@/lib/domain/checklist-edit";
import { leadSites } from "@/lib/domain/access";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { pickSite } from "../load";

export const dynamic = "force-dynamic";

/**
 * The operational checklists (opening, closing, cleans, temperature logs) as the owner edits them: one row per
 * checklist at the site, with the version in use and any draft. Only the owner edits; nothing is deleted.
 */
export default async function Checklists(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!canEditChecklists(ctx.person)) redirect("/shift");
  const db = store();
  const all = await db.sites();
  const { sites, site } = await pickSite(leadSites(ctx.person, all.map((s) => s.id)), searchParams.site, ctx.site.id);
  const lists = await db.checklistTemplates(site.id);
  const on = lists.filter((t) => t.active && t.published);
  const drafts = lists.filter((t) => t.draft);
  const off = lists.filter((t) => !t.active && t.published);
  const unpublished = lists.filter((t) => t.active && !t.published);

  const row = (t: (typeof lists)[number]) => (
    <Link key={t.id} href={`/manage/checklists/${t.id}`} className="list-btn">
      <span className="grow">
        <span className="strong" style={{ display: "block" }}>{t.name}</span>
        <span className="muted">{AREA_TEXT[t.area]} · {t.when}{t.due ? ` · due ${t.due}` : " · no due time"}{t.published ? ` · ${t.published.items.length} checks · v${t.published.version}` : ""}</span>
      </span>
      <span className="chips">
        {t.draft && <span className="chip warn">Draft v{t.draft.version}</span>}
        {!t.published && <span className="chip">Not published yet</span>}
        {!t.active && t.published && <span className="chip">Off</span>}
      </span>
    </Link>
  );

  return (
    <>
      <TopBar ctx={ctx} title="Checklists" eyebrow={`Owner · ${site.name}`} back="/owner">
        <Link className="pill-btn top-extra" href={`/manage/checklists/new?site=${site.id}`} style={{ background: "var(--amber)", color: "var(--amber-ink)" }}>New checklist</Link>
      </TopBar>
      <main>
        {sites.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/manage/checklists?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="muted lead">What the tablet asks each day at {site.name}. Change the checks as a new version: signed runs keep the version they were signed on, so the records never change.</span>
          <Link className="btn ghost small" href={`/manage/checklists/new?site=${site.id}`}>New checklist</Link>
        </div>

        {drafts.length > 0 && (
          <section className="stack" aria-label="Drafts" style={{ gap: 8 }}>
            <h2 className="grp-h">Being changed <span>{drafts.length}</span></h2>
            {drafts.map(row)}
          </section>
        )}
        <section className="stack" aria-label="In use" style={{ gap: 8 }}>
          <h2 className="grp-h">In use <span>{on.length}</span></h2>
          {on.length === 0 && <div className="card muted">No checklists in use at {site.name} yet.</div>}
          {on.filter((t) => !t.draft).map(row)}
        </section>
        {unpublished.filter((t) => !t.draft).length > 0 && (
          <section className="stack" aria-label="Never published" style={{ gap: 8 }}>
            <h2 className="grp-h">Never published <span>{unpublished.filter((t) => !t.draft).length}</span></h2>
            {unpublished.filter((t) => !t.draft).map(row)}
          </section>
        )}
        {off.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Switched off ({off.length})</summary>
            <div className="stack" style={{ marginTop: 10, gap: 8 }}>{off.filter((t) => !t.draft).map(row)}</div>
          </details>
        )}
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
