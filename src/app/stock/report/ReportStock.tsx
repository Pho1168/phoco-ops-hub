"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { repeatLastStockReport, saveStockReport, sendStockReportNow } from "@/app/actions";
import { upload } from "@/app/library/fields";
import { Icon } from "@/components/Icon";

interface P { id: string; name: string; size?: string; category?: string; typical?: number }
interface Line { productId: string; level: "low" | "out"; qty?: number; note?: string; photoId?: string }
/** Something not in the catalogue: sent to the owner to add. */
interface Extra { name: string; size?: string; qty?: number; note?: string }

const label = (p: P) => (p.size ? `${p.name} · ${p.size}` : p.name);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * Report Stock. Tap what you need ordered and say how many (in the product's own unit; it starts at the usual amount,
 * or 1), mark it urgent if you've run out, add a note or photo if it helps, check and send. The report is saved as
 * it's made, so it can be finished later. Something not on the list: add it as a new item (name, pack, how many),
 * and it goes to the owner to add to the catalogue. Nothing needed: say so.
 */
export function ReportStock({ siteName, products, frequent, open, draft, canRepeat }: {
  siteName: string; products: P[]; frequent: string[]; open: { productId: string; state: string }[];
  draft?: { lines: Line[]; noIssues: boolean; extras: Extra[] }; canRepeat: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? []);
  const [noIssues, setNoIssues] = useState(!!draft?.noIssues);
  const [extras, setExtras] = useState<Extra[]>(draft?.extras ?? []);
  const [adding, setAdding] = useState<Extra | undefined>();
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [step, setStep] = useState<"pick" | "review" | "sent">("pick");
  const [openId, setOpenId] = useState<string | undefined>();
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ created: number; again: number; noIssues: boolean; newItems: number } | undefined>();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<string | undefined>();
  const first = useRef(true);

  // Saved as it's made (a moment after the last change), so it can be finished later or on another screen.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (step === "sent") return;
    setSaving("saving");
    const t = setTimeout(async () => {
      const r = await saveStockReport({ lines, noIssues, extras });
      setSaving(r.ok ? "saved" : "error");
      if (!r.ok) setErr(r.error);
    }, 700);
    return () => clearTimeout(t);
  }, [lines, noIssues, extras, step]);

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
    if (!lineOf(p.id)) setLine(p.id, { level: "low", qty: p.typical ?? 1 });
    setOpenId(openId === p.id ? undefined : p.id);
  };
  const step1 = (l: Line, d: number) => setLine(l.productId, { qty: Math.max(1, Math.min(9999, (l.qty ?? 0) + d)) });
  const missing = lines.filter((l) => l.qty === undefined).length;
  const total = lines.length + extras.length;
  // Clear all: empties the unsent report in one go (what's already been sent stays with the owner).
  const clearAll = () => { setLines([]); setExtras([]); setNoIssues(false); setOpenId(undefined); setAdding(undefined); setClearing(false); setErr(""); };
  const addExtra = (x: Extra) => {
    setErr(""); setNoIssues(false);
    setExtras((xs) => [...xs.filter((o) => `${o.name}|${o.size ?? ""}`.toLowerCase() !== `${x.name}|${x.size ?? ""}`.toLowerCase()), x]);
    setAdding(undefined); setQuery("");
  };

  const send = () => start(async () => {
    setErr("");
    const saved = await saveStockReport({ lines, noIssues, extras });
    if (!saved.ok) { setErr(saved.error); return; }
    const r = await sendStockReportNow();
    if (!r.ok) { setErr(r.error); return; }
    setResult({ created: r.created ?? 0, again: r.again ?? 0, noIssues: !total, newItems: r.newItems ?? 0 });
    setStep("sent");
    setLines([]); setExtras([]); setNoIssues(false);
    router.refresh();
  });

  if (step === "sent" && result) {
    return (
      <main className="stack">
        <div className="alert good" role="status"><Icon name="check" />
          <div className="grow"><div className="strong">{result.noIssues ? "Recorded: no stock issues today" : "Report sent"}</div>
            {!result.noIssues && <div>{result.created} new request{result.created === 1 ? "" : "s"}{result.again ? `, ${result.again} already asked for (added to those)` : ""}{result.newItems ? `, ${result.newItems} new item${result.newItems === 1 ? "" : "s"} sent to the owner to add` : ""}. Thank you.</div>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <Link className="btn" href="/stock">Back to stock</Link>
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
          {!total && <div className="card">{noIssues ? "No stock issues today." : "Nothing picked yet."}</div>}
          <ul className="stock-review">
            {lines.map((l) => {
              const p = byId.get(l.productId);
              return (
                <li key={l.productId} className={l.level === "out" ? "out" : ""}>
                  <span className="grow"><span className="strong">{p ? label(p) : "?"}</span>{l.note && <span className="muted"> · {l.note}</span>}</span>
                  {l.level === "out" && <span className="chip bad">Urgent</span>}
                  {l.qty !== undefined
                    ? <span className="stock-qty">{`${fmt(l.qty)}${p?.size ? ` × ${p.size}` : ""}`}</span>
                    : <button type="button" className="chip bad" onClick={() => { setStep("pick"); setOpenId(l.productId); }}>How many?</button>}
                </li>
              );
            })}
            {extras.map((x) => (
              <li key={`${x.name}|${x.size ?? ""}`}>
                <span className="grow"><span className="strong">{x.size ? `${x.name} · ${x.size}` : x.name}</span>{x.note && <span className="muted"> · {x.note}</span>}</span>
                <span className="chip warn">New item</span>
                <span className="stock-qty">{x.qty !== undefined ? fmt(x.qty) : "?"}</span>
              </li>
            ))}
          </ul>
          {extras.length > 0 && <div className="muted" style={{ fontSize: 14 }}>New items go to the owner, who adds them to the catalogue and orders them.</div>}
          {missing > 0 && <div className="err" role="alert">Say how many you need of {missing === 1 ? "one item" : `${missing} items`} before sending.</div>}
          {err && <div className="err" role="alert">{err}</div>}
        </main>
        <div className="sticky-foot"><div className="inner">
          <button type="button" className="btn ghost" onClick={() => setStep("pick")}>Back</button>
          <button type="button" className="btn accent grow" disabled={pending || missing > 0 || (!total && !noIssues)} onClick={send}>{pending ? "Sending…" : total ? `Send report · ${total} item${total === 1 ? "" : "s"}` : "Send: no stock issues"}</button>
        </div></div>
      </>
    );
  }

  return (
    <>
      <main className="stack">
        <p className="muted lead" style={{ margin: 0 }}>Tap what you need ordered for {siteName} and say how many.</p>
        <div className="stock-tools">
          <input className="txt" type="search" placeholder="Search, e.g. lime" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="chips stock-cats" role="group" aria-label="Show">
            <button type="button" className={`chip ${cat === "all" && !q ? "done" : ""}`} onClick={() => setCat("all")}>All</button>
            {frequent.length > 0 && <button type="button" className={`chip ${cat === "frequent" && !q ? "done" : ""}`} onClick={() => setCat("frequent")}>Usual</button>}
            {cats.map((c) => <button key={c} type="button" className={`chip ${cat === c && !q ? "done" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        </div>
        {total > 0 && !q && (
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className="muted grow" style={{ fontSize: 14 }}>{total} item{total === 1 ? "" : "s"} picked, not sent yet</span>
            {clearing
              ? <>
                  <span className="strong">Clear all {total}?</span>
                  <button type="button" className="btn small" onClick={clearAll}>Yes, clear all</button>
                  <button type="button" className="btn ghost small" onClick={() => setClearing(false)}>Keep them</button>
                </>
              : <button type="button" className="btn ghost small" onClick={() => setClearing(true)}>Clear all</button>}
          </div>
        )}
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
        {extras.length > 0 && !q && (
          <section className="stack" aria-label="New items" style={{ gap: 8 }}>
            <h2 className="h-sec">New items, for the owner to add ({extras.length})</h2>
            {extras.map((x) => (
              <div key={`${x.name}|${x.size ?? ""}`} className="stock-item on">
                <div className="stock-head" style={{ cursor: "default" }}>
                  <span className="mark" aria-hidden="true">+</span>
                  <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
                    <span className="strong">{x.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{[x.size, x.note].filter(Boolean).join(" · ") || "Not in the catalogue yet"}</span>
                  </span>
                  <span className="chip warn">{x.qty !== undefined ? fmt(x.qty) : "How many?"}</span>
                  <button type="button" className="btn ghost small" onClick={() => setAdding({ ...x })}>Change</button>
                  <button type="button" className="btn ghost small" aria-label={`Take ${x.name} off`} onClick={() => setExtras((xs) => xs.filter((o) => o !== x))}>Take off</button>
                </div>
              </div>
            ))}
          </section>
        )}
        {adding
          ? <NewItemForm initial={adding} onAdd={addExtra} onCancel={() => setAdding(undefined)} />
          : (
            <div className="card stack" style={{ gap: 10 }}>
              <div className="strong">Not on the list?</div>
              <div className="muted" style={{ fontSize: 14 }}>Add it as a new item. The owner adds it to the catalogue and orders it, and it&apos;s on the list next time.</div>
              <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAdding({ name: query.trim(), qty: 1 })}>
                {q ? `Add “${query.trim()}” as a new item` : "Add a new item"}
              </button>
            </div>
          )}
        {!total && (
          <div className="card stack" style={{ gap: 10 }}>
            <div className="strong">Checked, and nothing is needed?</div>
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
        <div className="prep-count" aria-live="polite"><b>{total}</b><span>items</span></div>
        <span className="muted grow" style={{ fontSize: 13 }}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved: finish any time" : saving === "error" ? "Not saved" : ""}</span>
        <button type="button" className="btn accent" disabled={!total && !noIssues} onClick={() => setStep("review")}>Review and send</button>
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
          <span className="mark" aria-hidden="true">{l ? (l.level === "out" ? "!" : "✓") : ""}</span>
          <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
            <span className="strong">{p.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{p.size ?? "each"}{already ? ` · already asked for: ${already.toLowerCase()}` : ""}</span>
          </span>
          {l && <span className={`chip ${l.level === "out" ? "bad" : l.qty === undefined ? "bad" : "warn"}`}>{l.qty !== undefined ? fmt(l.qty) : "How many?"}{l.level === "out" ? " · urgent" : ""}</span>}
        </button>
        {isOpen && (
          <div className="stock-edit stack">
            <div className="row wrap" style={{ gap: 10 }}>
              <span className="strong">Need</span>
              <div className="stepper" role="group" aria-label={`${p.name}: how many`}>
                <button type="button" aria-label="One less" onClick={() => step1(l, -1)}>−</button>
                <input className="txt" inputMode="decimal" aria-label="Quantity" value={l.qty !== undefined ? fmt(l.qty) : ""} placeholder="0"
                  onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setLine(p.id, { qty: e.target.value.trim() === "" || !Number.isFinite(n) || n <= 0 ? undefined : n }); }} />
                <button type="button" aria-label="One more" onClick={() => step1(l, 1)}>+</button>
              </div>
              <span className="muted">× {p.size ?? "each"}</span>
            </div>
            <button type="button" className={`chip ${l.level === "out" ? "bad" : ""}`} aria-pressed={l.level === "out"} style={{ alignSelf: "flex-start" }}
              onClick={() => setLine(p.id, { level: l.level === "out" ? "low" : "out" })}>{l.level === "out" ? "Urgent: we've run out" : "Mark urgent (we've run out)"}</button>
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

/** The new-item form: what it is, the pack or size if known, how many, and a note. */
function NewItemForm({ initial, onAdd, onCancel }: { initial: Extra; onAdd: (x: Extra) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [size, setSize] = useState(initial.size ?? "");
  const [qty, setQty] = useState(initial.qty !== undefined ? String(initial.qty) : "1");
  const [note, setNote] = useState(initial.note ?? "");
  const n = Number(qty.replace(",", "."));
  const okName = name.trim().length >= 2 && name.trim().length <= 80;
  const okQty = qty.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 9999;
  const bump = (d: number) => setQty(String(Math.max(1, Math.min(9999, (okQty ? n : 0) + d))));
  return (
    <div className="card stack" style={{ gap: 12 }} role="group" aria-label="New item">
      <div className="strong">New item</div>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: 14 }}>What is it?</span>
        <input className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={80} placeholder="e.g. Nitrile gloves, large" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: 14 }}>Pack or size (if you know)</span>
        <input className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={40} placeholder="e.g. Box of 100" value={size} onChange={(e) => setSize(e.target.value)} />
      </label>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="strong">How many</span>
        <div className="stepper" role="group" aria-label="New item: how many">
          <button type="button" aria-label="One less" onClick={() => bump(-1)}>−</button>
          <input className="txt" inputMode="decimal" aria-label="New item quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="button" aria-label="One more" onClick={() => bump(1)}>+</button>
        </div>
      </div>
      <input className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={200} placeholder="Note (optional), e.g. the blue ones from Booker" aria-label="New item note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn grow" disabled={!okName || !okQty}
          onClick={() => onAdd({ name: name.trim().replace(/\s+/g, " "), ...(size.trim() ? { size: size.trim() } : {}), qty: Math.round(n * 100) / 100, ...(note.trim() ? { note: note.trim() } : {}) })}>Add to my report</button>
      </div>
    </div>
  );
}
