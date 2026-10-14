"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checklistDiscard, checklistPublish, checklistSaveDraft } from "@/app/actions";
import { ANSWER_TYPES, HINT_MAX, SECTION_MAX, TEXT_MAX, sameItems, type DraftItem } from "@/lib/domain/checklist-edit";
import type { AnswerType } from "@/lib/domain/types";

interface Row extends DraftItem { key: number }

let seq = 1;
const row = (i?: DraftItem): Row => ({ key: seq++, section: i?.section ?? "", text: i?.text ?? "", type: i?.type ?? "tick", ruleCode: i?.ruleCode ?? "", hint: i?.hint ?? "" });
const strip = (rows: Row[]): DraftItem[] => rows.map((r) => ({ section: r.section, text: r.text, type: r.type, ruleCode: r.ruleCode || undefined, hint: r.hint || undefined }));

/**
 * The checks, edited as a whole: a section name on the row that starts a section (rows below it stay in it until
 * the next one), what's checked, what's recorded, a limit for temperatures, a hint. Saved as the draft; published as the next version.
 */
export function ItemsEditor({ templateId, initial, hasDraft, hasPublished, rules }: {
  templateId: string; initial: DraftItem[]; hasDraft: boolean; hasPublished: boolean; rules: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => {
    // Only the first row of each section shows its name; the rest inherit it (cleanItems carries it down).
    let last = "";
    return initial.map((i) => { const r = row(i); if (r.section === last) r.section = ""; else last = r.section; return r; });
  });
  const [saved, setSaved] = useState<DraftItem[]>(initial);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const dirty = !sameItems(fillSections(strip(rows)), saved);

  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const move = (k: number, d: -1 | 1) => setRows((rs) => {
    const i = rs.findIndex((r) => r.key === k), j = i + d;
    if (i < 0 || j < 0 || j >= rs.length) return rs;
    const out = [...rs]; [out[i], out[j]] = [out[j], out[i]]; return out;
  });
  const remove = (k: number) => setRows((rs) => rs.filter((r) => r.key !== k));
  const add = (after?: number) => setRows((rs) => {
    const i = after === undefined ? rs.length : rs.findIndex((r) => r.key === after) + 1;
    return [...rs.slice(0, i), row(), ...rs.slice(i)];
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (r.ok) { setMsg(done); router.refresh(); } else setErr(r.error ?? "That couldn't be saved");
  });
  const save = () => run(async () => {
    const items = fillSections(strip(rows));
    const r = await checklistSaveDraft(templateId, items);
    if (r.ok) setSaved(items);
    return r;
  }, "Draft saved");
  const publish = () => {
    if (!confirm(hasPublished ? "Publish this as the new version? The tablet asks these checks from the next run." : "Publish this checklist? The tablet starts asking these checks.")) return;
    run(async () => {
      if (dirty) {
        const items = fillSections(strip(rows));
        const s = await checklistSaveDraft(templateId, items);
        if (!s.ok) return s;
        setSaved(items);
      }
      return checklistPublish(templateId);
    }, "Published");
  };
  const discard = () => {
    if (!confirm(hasPublished ? "Discard the draft? The version in use stays as it is." : "Discard the draft? This checklist was never published, so it will be switched off.")) return;
    run(() => checklistDiscard(templateId), "Draft discarded");
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.length === 0 && <div className="card muted">No checks yet. Add the first one.</div>}
      <ol className="ck-rows" aria-label="Checks">
        {rows.map((r, n) => (
          <li key={r.key} className={`ck-row ${r.section ? "starts" : ""}`}>
            <input className="txt ck-section" maxLength={SECTION_MAX} placeholder={n === 0 ? "Section, e.g. Fridges" : "Same section…"} aria-label={`Section for check ${n + 1}`}
              value={r.section} onChange={(e) => set(r.key, { section: e.target.value })} />
            <span className="ck-n">{n + 1}</span>
            <input className="txt ck-text" maxLength={TEXT_MAX} placeholder="What's checked, e.g. Walk-in fridge" aria-label={`Check ${n + 1}`}
              value={r.text} onChange={(e) => set(r.key, { text: e.target.value })} />
            <select className="ck-type" aria-label={`What's recorded for check ${n + 1}`} value={r.type} onChange={(e) => set(r.key, { type: e.target.value as AnswerType })}>
              {ANSWER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {r.type === "temp" ? (
              <select className="ck-rule" aria-label={`Limit for check ${n + 1}`} value={r.ruleCode} onChange={(e) => set(r.key, { ruleCode: e.target.value })}>
                <option value="">Limit…</option>
                {rules.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            ) : (
              <input className="txt ck-hint" maxLength={HINT_MAX} placeholder="Hint (optional)" aria-label={`Hint for check ${n + 1}`}
                value={r.hint} onChange={(e) => set(r.key, { hint: e.target.value })} />
            )}
            <span className="ck-tools">
              <button type="button" className="btn ghost small" aria-label={`Move check ${n + 1} up`} disabled={n === 0} onClick={() => move(r.key, -1)}>↑</button>
              <button type="button" className="btn ghost small" aria-label={`Move check ${n + 1} down`} disabled={n === rows.length - 1} onClick={() => move(r.key, 1)}>↓</button>
              <button type="button" className="btn ghost small" aria-label={`Add a check after ${n + 1}`} onClick={() => add(r.key)}>+</button>
              <button type="button" className="btn ghost small" aria-label={`Remove check ${n + 1}`} onClick={() => remove(r.key)}>×</button>
            </span>
          </li>
        ))}
      </ol>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn ghost small" onClick={() => add()}>Add a check</button>
        <span className="grow" />
        {msg && <span className="muted">{msg}</span>}
        {hasDraft && <button type="button" className="btn ghost small" disabled={pending} onClick={discard}>Discard draft</button>}
        <button type="button" className="btn small" disabled={pending || !dirty} onClick={save}>Save draft</button>
        <button type="button" className="btn accent small" disabled={pending || rows.length === 0 || (!dirty && !hasDraft)} onClick={publish}>{hasPublished ? "Publish as new version" : "Publish"}</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="muted" style={{ fontSize: 13 }}>A temperature check is judged against its limit from the HACCP plan and raises an alert when it&apos;s out. A section name goes on the first check of the section; the ones below follow it.</div>
    </div>
  );
}

/** Rows inherit the section above them, so the editor can show it once. */
function fillSections(items: DraftItem[]): DraftItem[] {
  let last = "General";
  return items.map((i) => { if (i.section) last = i.section; return { ...i, section: last }; });
}
