"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { repeatLastStockReport, saveStockReport, sendStockReportNow } from "@/app/actions";
import { upload } from "@/app/library/fields";
import { Icon } from "@/components/Icon";

interface P { id: string; name: string; size?: string; category?: string; typical?: number }
interface Line { productId: string; level: "low" | "out"; qty?: number; note?: string; photoId?: string }

const label = (p: P) => (p.size ? `${p.name} · ${p.size}` : p.name);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * Report Stock. Tap what's low or out, say how many (in the product's own unit, or "not sure"), add a note or photo if
 * it helps, check and send. The report is saved as it's made, so it can be finished later. Nothing to report: say so.
 */
export function ReportStock({ siteName, products, frequent, open, draft, canRepeat }: {
  siteName: string; products: P[]; frequent: string[]; open: { productId: string; state: string }[];
  draft?: { lines: Line[]; noIssues: boolean }; canRepeat: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? []);
  const [noIssues, setNoIssues] = useState(!!draft?.noIssues);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>(frequent.length ? "frequent" : "all");
  const [step, setStep] = useState<"pick" | "review" | "sent">("pick");
  const [openId, setOpenId] = useState<string | undefined>();
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ created: number; again: number; noIssues: boolean } | undefined>();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<string | undefined>();
  const first = useRef(true);

  // Saved as it's made (a moment after the last change), so it can be finished later or on another screen.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (step === "sent") return;
    setSaving("saving");
    const t = setTimeout(async () => {
      const r = await saveStockReport({ lines, noIssues });
      setSaving(r.ok ? "saved" : "error");
      if (!r.ok) setErr(r.error);
    }, 700);
    return () => clearTimeout(t);
  }, [lines, noIssues, step]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const openBy = useMemo(() => new Map(open.map((o) => [o.productId, o.state])), [open]);
  const cats = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(), [products]);
  const q = query.trim().toLowerCase();
  const shown = products.filter((p) => q ? `${p.name} ${p.size ?? ""}`.toLowerCase().includes(q)
    : cat === "frequent" ? frequent.includes(p.id) : cat === "all" ? true : p.category === cat);
  if (!q && cat === "frequent") shown.sort((a, b) => frequent.indexOf(a.id) - frequent.indexOf(b.id));

  const lineOf = (id: string) => lines.find((l) => l.productId === id);
  const setLine = (id: string, patch: Partial<Line> | null) => {
    setErr("");
    setNoIssues(false);
    setLines((ls) => {
      if (patch === null) return ls.filter((l) => l.productId !== id);
      const cur = ls.find((l) => l.productId === id);
      if (cur) return ls.map((l) => (l.productId === id ? { ...l, ...patch } : l));
      return [...ls, { productId: id, level: "low", ...patch }];
    });
  };
  const tap = (p: P) => {
    if (!lineOf(p.id)) setLine(p.id, { level: "low" });
    setOpenId(openId === p.id ? undefined : p.id);
  };
  const step1 = (l: Line, d: number) => setLine(l.productId, { qty: Math.max(0, Math.min(9999, (l.qty ?? 0) + d)) || undefined });

  const send = () => start(async () => {
    setErr("");
    const saved = await saveStockReport({ lines, noIssues });
    if (!saved.ok) { setErr(saved.error); return; }
    const r = await sendStockReportNow();
    if (!r.ok) { setErr(r.error); return; }
    setResult({ created: r.created ?? 0, again: r.again ?? 0, noIssues: !lines.length });
    setStep("sent");
    setLines([]); setNoIssues(false);
    router.refresh();
  });

  if (step === "sent" && result) {
    return (
      <main className="stack">
        <div className="alert good" role="status"><Icon name="check" />
          <div className="grow"><div className="strong">{result.noIssues ? "Recorded: no stock issues today" : "Report sent"}</div>
            {!result.noIssues && <div>{result.created} new request{result.created === 1 ? "" : "s"}{result.again ? `, ${result.again} already asked for (added to those)` : ""}. Thank you.</div>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <Link className="btn" href="/stock/requests">See requests</Link>
          <button type="button" className="btn ghost" onClick={() => { setResult(undefined); setStep("pick"); }}>Report something else</button>
        </div>
      </main>
    );
  }

  if (step === "review") {
    return (
      <>
        <main className="stack">
          <h2 className="h-sec">Check your report · {siteName}</h2>
          {!lines.length && <div className="card">{noIssues ? "No stock issues today." : "Nothing picked yet."}</div>}
          <ul className="stock-review">
            {lines.map((l) => {
              const p = byId.get(l.productId);
              return (
                <li key={l.productId} className={l.level === "out" ? "out" : ""}>
                  <span className="grow"><span className="strong">{p ? label(p) : "?"}</span>{l.note && <span className="muted"> · {l.note}</span>}</span>
                  <span className={`chip ${l.level === "out" ? "bad" : "warn"}`}>{l.level === "out" ? "Out" : "Low"}</span>
                  <span className="stock-qty">{l.qty !== undefined ? `${fmt(l.qty)}${p?.size ? ` × ${p.size}` : ""}` : "Not sure"}</span>
                </li>
              );
            })}
          </ul>
          {err && <div className="err" role="alert">{err}</div>}
        </main>
        <div className="sticky-foot"><div className="inner">
          <button type="button" className="btn ghost" onClick={() => setStep("pick")}>Back</button>
          <button type="button" className="btn accent grow" disabled={pending || (!lines.length && !noIssues)} onClick={send}>{pending ? "Sending…" : lines.length ? `Send report · ${lines.length} item${lines.length === 1 ? "" : "s"}` : "Send: no stock issues"}</button>
        </div></div>
      </>
    );
  }

  return (
    <>
      <main className="stack">
        <p className="muted lead" style={{ margin: 0 }}>Tap what&apos;s running low or out at {siteName}. Say how many you need if you know; leave it as not sure if you don&apos;t.</p>
        <div className="stock-tools">
          <input className="txt" type="search" placeholder="Search, e.g. lime" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="chips stock-cats" role="group" aria-label="Show">
            {frequent.length > 0 && <button type="button" className={`chip ${cat === "frequent" && !q ? "done" : ""}`} onClick={() => setCat("frequent")}>Usual</button>}
            <button type="button" className={`chip ${cat === "all" && !q ? "done" : ""}`} onClick={() => setCat("all")}>All</button>
            {cats.map((c) => <button key={c} type="button" className={`chip ${cat === c && !q ? "done" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        </div>
        {lines.length > 0 && !q && (
          <section className="stack" aria-label="In your report" style={{ gap: 8 }}>
            <h2 className="h-sec">In your report ({lines.length})</h2>
            <div className="stock-list">{lines.map((l) => byId.get(l.productId)).filter(Boolean).map((p) => row(p!))}</div>
          </section>
        )}
        <section className="stack" aria-label="Products" style={{ gap: 8 }}>
          {shown.length === 0 && <div className="card muted">{q ? `Nothing matches "${query}".` : "Nothing here yet."}</div>}
          <div className="stock-list">{shown.filter((p) => q || !lineOf(p.id)).map(row)}</div>
        </section>
        {!lines.length && (
          <div className="card stack" style={{ gap: 10 }}>
            <div className="strong">Checked, and nothing is low?</div>
            <button type="button" className={`btn ${noIssues ? "" : "ghost"}`} aria-pressed={noIssues} onClick={() => setNoIssues(!noIssues)}>
              {noIssues ? <><Icon name="check" />No stock issues today</> : "No stock issues today"}
            </button>
          </div>
        )}
        {canRepeat && (
          <button type="button" className="btn ghost small" disabled={pending} onClick={() => start(async () => {
            const r = await repeatLastStockReport();
            if (!r.ok) { setErr(r.error); return; }
            window.location.reload();
          })}>Start from the last report</button>
        )}
        {err && <div className="err" role="alert">{err}</div>}
      </main>
      <div className="sticky-foot"><div className="inner">
        <div className="prep-count" aria-live="polite"><b>{lines.length}</b><span>items</span></div>
        <span className="muted grow" style={{ fontSize: 13 }}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved: finish any time" : saving === "error" ? "Not saved" : ""}</span>
        <button type="button" className="btn accent" disabled={!lines.length && !noIssues} onClick={() => setStep("review")}>Review and send</button>
      </div></div>
    </>
  );

  function row(p: P) {
    const l = lineOf(p.id);
    const isOpen = openId === p.id && l;
    const already = openBy.get(p.id);
    return (
      <div key={p.id} className={`stock-item ${l ? "on" : ""} ${l?.level === "out" ? "out" : ""}`}>
        <button type="button" className="stock-head" aria-expanded={!!isOpen} onClick={() => tap(p)}>
          <span className="mark" aria-hidden="true">{l ? (l.level === "out" ? "!" : "–") : ""}</span>
          <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
            <span className="strong">{p.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{p.size ?? "each"}{already ? ` · already asked for: ${already.toLowerCase()}` : ""}</span>
          </span>
          {l && <span className={`chip ${l.level === "out" ? "bad" : "warn"}`}>{l.level === "out" ? "Out" : "Low"} · {l.qty !== undefined ? fmt(l.qty) : "?"}</span>}
        </button>
        {isOpen && (
          <div className="stock-edit stack">
            <div className="seg" role="group" aria-label={`${p.name}: how bad`}>
              <button type="button" aria-pressed={l.level === "low"} onClick={() => setLine(p.id, { level: "low" })}>Low</button>
              <button type="button" aria-pressed={l.level === "out"} onClick={() => setLine(p.id, { level: "out" })}>Out of stock</button>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <span className="strong">Need</span>
              <div className="stepper" role="group" aria-label={`${p.name}: how many`}>
                <button type="button" aria-label="One less" onClick={() => step1(l, -1)}>−</button>
                <input className="txt" inputMode="decimal" aria-label="Quantity" value={l.qty !== undefined ? fmt(l.qty) : ""} placeholder="?"
                  onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setLine(p.id, { qty: e.target.value.trim() === "" || !Number.isFinite(n) || n <= 0 ? undefined : n }); }} />
                <button type="button" aria-label="One more" onClick={() => step1(l, 1)}>+</button>
              </div>
              <span className="muted">× {p.size ?? "each"}</span>
              <button type="button" className={`chip ${l.qty === undefined ? "done" : ""}`} onClick={() => setLine(p.id, { qty: undefined })}>Not sure</button>
            </div>
            {p.typical !== undefined && l.qty !== p.typical && <button type="button" className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setLine(p.id, { qty: p.typical })}>Usually {fmt(p.typical)}: use that</button>}
            <input className="txt" maxLength={200} placeholder="Note (optional), e.g. half a box left" aria-label={`Note for ${p.name}`} value={l.note ?? ""} onChange={(e) => setLine(p.id, { note: e.target.value })} />
            <div className="row wrap" style={{ gap: 8 }}>
              <label className="btn ghost small" style={{ cursor: uploading ? "progress" : "pointer" }}>
                <Icon name="camera" />{uploading === p.id ? "Uploading…" : l.photoId ? "Photo added · change" : "Add a photo"}
                <input type="file" accept="image/*" capture="environment" hidden disabled={!!uploading} onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = "";
                  if (!f) return;
                  setUploading(p.id);
                  try { const ph = await upload(f, "stock"); setLine(p.id, { photoId: ph.id }); } catch (x) { setErr((x as Error).message); }
                  setUploading(undefined);
                }} />
              </label>
              <button type="button" className="btn ghost small" onClick={() => { setLine(p.id, null); setOpenId(undefined); }}>Take it off</button>
              <button type="button" className="btn small grow" onClick={() => setOpenId(undefined)}>Done</button>
            </div>
          </div>
        )}
      </div>
    );
  }
}
