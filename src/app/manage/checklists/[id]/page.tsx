import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { AREA_TEXT, canEditChecklists, toDraftItems } from "@/lib/domain/checklist-edit";
import { dayMonthYearAt } from "@/app/library/format";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { ItemsEditor } from "./ItemsEditor";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", published: "In use", retired: "Replaced", discarded: "Discarded" };

/** One checklist: its settings (take effect at once) and its checks (edited as a draft, published as the next version). */
export default async function ChecklistEditor(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx();
  if (!canEditChecklists(ctx.person)) redirect("/shift");
  const db = store();
  const t = await db.checklistTemplate(id);
  if (!t) notFound();
  const [site, versions, rules, people] = await Promise.all([db.site(t.siteId), db.checklistVersions(t.id), db.rules(), db.people()]);
  const name = (pid?: string) => (pid ? people.find((p) => p.id === pid)?.name : undefined);
  const base = t.draft ?? t.published;
  const ruleOptions = Object.values(rules).map((r) => ({
    code: r.code, label: `${r.label}${r.targetMax !== undefined ? ` · ${r.targetMax}°C or below` : r.targetMin !== undefined ? ` · ${r.targetMin}°C or above` : ""}`,
  }));

  return (
    <>
      <TopBar ctx={ctx} title={t.name} eyebrow={`${site?.name ?? t.siteId} · ${AREA_TEXT[t.area]} · ${t.published ? `v${t.published.version} in use` : "not published yet"}`} back={`/manage/checklists?site=${t.siteId}`} />
      <main className="wide">
        {!t.active && t.published && <div className="alert" role="status"><div className="strong">Switched off: nobody is asked to do it. Switch it on below to bring it back.</div></div>}
        {!t.published && !t.draft && <div className="alert" role="status"><div className="strong">Its draft was discarded before it was ever published, so it&apos;s off. Add checks and publish to use it.</div></div>}

        <section className="card stack" aria-label="Settings" style={{ gap: 10 }}>
          <h2 className="h-sec">Settings</h2>
          <div className="muted" style={{ fontSize: 13 }}>These take effect straight away.</div>
          <SettingsForm id={t.id} name={t.name} when={t.when} due={t.due ?? ""} active={t.active} published={!!t.published} />
        </section>

        <section className="stack" aria-label="Checks" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
            <h2 className="h-sec grow">The checks</h2>
            {t.draft
              ? <span className="chip warn">Draft v{t.draft.version}{t.draft.updatedAt ? ` · saved ${dayMonthYearAt(t.draft.updatedAt)}` : ""}</span>
              : t.published ? <span className="chip done">v{t.published.version} in use</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {t.draft
              ? "You're editing a draft. Staff keep seeing the version in use until you publish it."
              : t.published ? "Changing anything here starts a draft; the version in use stays as it is until you publish." : "Add the checks, save, then publish."}
          </div>
          <ItemsEditor templateId={t.id} initial={base ? toDraftItems(base.items) : []} hasDraft={!!t.draft} hasPublished={!!t.published} rules={ruleOptions} />
        </section>

        {versions.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Versions ({versions.length})</summary>
            <div className="stack" style={{ marginTop: 10, gap: 6 }}>
              {versions.map((v) => (
                <div key={v.id} className="row wrap" style={{ gap: 8 }}>
                  <span className="strong">v{v.version}</span>
                  <span className={`chip ${v.status === "published" ? "done" : v.status === "draft" ? "warn" : ""}`}>{STATUS[v.status]}</span>
                  <span className="muted grow">{v.note ?? ""}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {v.status === "published" || v.status === "retired"
                      ? `published ${v.publishedAt ? dayMonthYearAt(v.publishedAt) : ""}${name(v.publishedBy) ? ` by ${name(v.publishedBy)}` : ""}`
                      : `${v.createdAt ? dayMonthYearAt(v.createdAt) : ""}${name(v.createdBy) ? ` by ${name(v.createdBy)}` : ""}`}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
