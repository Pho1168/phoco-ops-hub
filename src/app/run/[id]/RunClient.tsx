"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerItem, recordAction, signOffRun } from "@/app/actions";
import { Icon } from "@/components/Icon";
import type { AnswerType, Outcome } from "@/lib/domain/types";

export interface RunItemView {
  id: string; section: string; text: string; type: AnswerType; tag?: string; meta: string;
  value: string; outcome: Outcome; action?: string;
  warnActions: string[]; badActions: string[]; warnMsg: string; badMsg: string;
}

interface Props {
  listId: string; name: string; siteName: string; when: string; due?: string; suggested: boolean;
  items: RunItemView[]; answered: number; total: number; needsAction: number;
  signed: { by: string; at: string } | null;
}

export function RunClient(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState(false);
  const [pin, setPin] = useState("");
  const [signErr, setSignErr] = useState("");
  const locked = !!p.signed;

  const send = (id: string, raw: string | boolean) => start(async () => {
    const r = await answerItem(p.listId, id, raw);
    setErrors((e) => ({ ...e, [id]: r.ok ? "" : r.error }));
    router.refresh();
  });
  const act = (id: string, a: string) => start(async () => { await recordAction(p.listId, id, a); router.refresh(); });
  const sign = () => start(async () => {
    const r = await signOffRun(p.listId, pin);
    if (r.ok) { setSigning(false); setPin(""); router.refresh(); } else setSignErr(r.error);
  });

  const ready = p.answered === p.total && p.needsAction === 0 && !locked;
  const pct = Math.round((p.answered / Math.max(p.total, 1)) * 100);
  const sections: { name: string; items: RunItemView[] }[] = [];
  for (const it of p.items) {
    const last = sections[sections.length - 1];
    if (!last || last.name !== it.section) sections.push({ name: it.section, items: [it] }); else last.items.push(it);
  }

  return (
    <>
      <main>
        <section className="run-head">
          <div className="row">
            <Link className="pill-btn" href="/today" aria-label="Back to today"><Icon name="back" /></Link>
            <span style={{ fontSize: 13, opacity: 0.85 }}>{p.siteName} · {p.when}{p.due ? ` · due ${p.due}` : ""}</span>
          </div>
          <h1 className="h-display">{p.name}</h1>
          <div className="row">
            <div className="bar grow"><i style={{ width: `${pct}%` }} /></div>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{p.answered} of {p.total}</strong>
          </div>
          {p.suggested && <div style={{ fontSize: 13, opacity: 0.85 }}>Suggested checklist, not in your current files.</div>}
        </section>

        {p.signed && (
          <div className="alert good"><Icon name="check" /><div><div className="strong">Signed off by {p.signed.by} at {p.signed.at}</div><div style={{ fontSize: 13 }}>Records are locked. Corrections are added as new entries by a manager.</div></div></div>
        )}

        {sections.map((s) => (
          <section key={s.name} className="stack" style={{ gap: 8 }}>
            <h2 className="h-sec">{s.name}</h2>
            <div className="items">
              {s.items.map((it) => {
                const flagged = (it.outcome === "warn" && it.warnActions.length > 0) || (it.outcome === "bad" && it.badActions.length > 0);
                const acts = it.outcome === "bad" ? it.badActions : it.warnActions;
                return (
                  <div key={it.id}>
                    <div className={`item ${it.type === "tick" && it.outcome === "done" ? "done" : ""}`}>
                      <div className="item-text">
                        <span className="lbl">{it.text}</span>
                        {it.meta && <span className="muted">{it.meta}</span>}
                      </div>
                      {it.type === "tick" && (
                        <button type="button" className="tick" aria-pressed={it.outcome === "done"} aria-label={`Mark done: ${it.text}`} disabled={locked || pending} onClick={() => send(it.id, it.outcome !== "done")}>
                          {it.outcome === "done" && <Icon name="check" />}
                        </button>
                      )}
                      {it.type === "temp" && (
                        <label className="row" style={{ gap: 6 }}>
                          <span className="sr-only">{it.text} in °C</span>
                          <input id={`v-${it.id}`} className={`num ${it.outcome === "todo" ? "" : it.outcome}`} inputMode="decimal" defaultValue={it.value} placeholder="—" disabled={locked}
                            onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.value) send(it.id, e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          <span className="muted">°C</span>
                        </label>
                      )}
                      {(it.type === "number" || it.type === "text") && (
                        <input id={`v-${it.id}`} className="txt" inputMode={it.type === "number" ? "decimal" : "text"} defaultValue={it.value} placeholder={it.type === "number" ? "£ total" : "Type here"} aria-label={it.text} disabled={locked}
                          onBlur={(e) => { if (e.target.value.trim() !== it.value) send(it.id, e.target.value); }} />
                      )}
                      {it.type === "photo" && (it.value ? <span className="chip done">Photo added</span> : (
                        <label className="btn ghost small">Add photo
                          <input id={`v-${it.id}`} type="file" accept="image/*" className="sr-only" disabled={locked} onChange={(e) => { const f = e.target.files?.[0]; if (f) send(it.id, f.name); }} />
                        </label>
                      ))}
                    </div>
                    {errors[it.id] && <div className="field-err" role="alert">{errors[it.id]}</div>}
                    {flagged && (
                      <div className={`fix ${it.outcome === "warn" ? "warn" : ""}`} role="alert">
                        <strong style={{ fontSize: 14 }}>{it.outcome === "bad" ? it.badMsg : it.warnMsg}</strong>
                        {it.outcome === "bad" && <span style={{ fontSize: 13 }}>Manager alerted · urgent task created</span>}
                        <div className="choices">
                          {acts.map((a) => <button key={a} type="button" className="choice" aria-pressed={it.action === a} disabled={locked || pending} onClick={() => act(it.id, a)}>{a}</button>)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {!locked && (
        <div className="sticky-foot"><div className="inner">
          <Link className="btn ghost" href="/handover">Report issue</Link>
          <button type="button" className={`btn grow ${ready ? "accent" : ""}`} disabled={!ready || pending} onClick={() => { setSigning(true); setSignErr(""); }}>
            {ready ? "Sign off · enter PIN" : p.needsAction ? `${p.needsAction} reading${p.needsAction > 1 ? "s need" : " needs"} action` : `${p.total - p.answered} checks left`}
          </button>
        </div></div>
      )}

      {signing && (
        <div className="modal-back" onKeyDown={(e) => { if (e.key === "Escape") setSigning(false); }}>
          <form className="modal" role="dialog" aria-label="Sign off" onSubmit={(e) => { e.preventDefault(); sign(); }}>
            <h2 className="h-sec">Sign off {p.name}</h2>
            <label className="stack" style={{ gap: 6 }}>
              <span className="muted">Enter your PIN to sign</span>
              <input id="sign-pin" className="num" style={{ width: "100%" }} type="password" inputMode="numeric" maxLength={4} autoComplete="off" autoFocus required value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
            {signErr && <div className="err" role="alert">{signErr}</div>}
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setSigning(false)}>Cancel</button>
              <button className="btn accent grow" type="submit" disabled={pending}>Sign off</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
