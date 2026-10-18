"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { editSiteNeededAction, repeatLastStockReport, saveStockReport, sendStockReportNow } from "@/app/actions";
import { upload } from "@/app/library/fields";
import { Icon } from "@/components/Icon";

interface P { id: string; name: string; size?: string; category?: string; typical?: number }
interface Line { productId: string; level: "low" | "out"; qty?: number; note?: string; photoId?: string }
/** Something not in the catalogue: sent to the owner to add. */
interface Extra { name: string; size?: string; qty?: number; note?: string }
/** What the restaurant already has on Stock needed (until the buyer ticks it off). */
export interface Waiting {
  productId: string; name: string; pack?: string; qty: number; unknown: boolean; urgent: boolean; supplier: string;
  /** Still only waiting: the amount can be changed or it can be removed (on the tablet). */
  editable: boolean; status?: string;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const MAX = 9999;

/**
 * Report Stock, on one page. Left: the catalogue (search, All, Usual, categories); tap what you need. Right: your list,
 * each item with how many (it starts at the usual amount, or 1), urgent, a note or photo, or take it off; then Submit,
 * and it goes to Stock needed. Below it, what's already on Stock needed for the restaurant, until the buyer ticks it
 * off (on the tablet its amount can be changed or it can be removed). Picking something already waiting replaces its
 * amount. The list is saved as it's made, so it can be finished later. Not in the catalogue: add a new item for the
 * owner. Nothing needed: say so.
 */
export function ReportStock({ siteName, products, frequent, open, waiting, canEditWaiting, draft, canRepeat }: {
  siteName: string; products: P[]; frequent: string[]; open: { productId: string; state: string }[]; waiting: Waiting[]; canEditWaiting: boolean;
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
  const [noteOpen, setNoteOpen] = useState<string | undefined>();
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const first = useRef(true);
  const skipSave = useRef(false);

  // Saved as it's made (a moment after the last change), so it can be finished later or on another screen.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (skipSave.current) { skipSave.current = false; return; }
    setSaving("saving");
    const t = setTimeout(async () => {
      const r = await saveStockReport({ lines, noIssues, extras });
      setSaving(r.ok ? "saved" : "error");
      if (!r.ok) setErr(r.error);
    }, 700);
    return () => clearTimeout(t);
  }, [lines, noIssues, extras]);
  useEffect(() => { setEditing(null); setRemoving(null); }, [waiting]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const openBy = useMemo(() => new Map(open.map((o) => [o.productId, o.state])), [open]);
  const waitingBy = useMemo(() => new Map(waiting.map((w) => [w.productId, w])), [waiting]);
  const cats = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(), [products]);
  const q = query.trim().toLowerCase();
  const shown = products.filter((p) => q ? `${p.name} ${p.size ?? ""}`.toLowerCase().includes(q)
    : cat === "frequent" ? frequent.includes(p.id) : cat === "all" ? true : p.category === cat);
  if (!q && cat === "frequent") shown.sort((a, b) => frequent.indexOf(a.id) - frequent.indexOf(b.id));

  const lineOf = (id: string) => lines.find((l) => l.productId === id);
  const setLine = (id: string, patch: Partial<Line> | null) => {
    setErr(""); setSent(undefined);
    setNoIssues(false);
    setLines((ls) => {
      if (patch === null) return ls.filter((l) => l.productId !== id);
      const cur = ls.find((l) => l.productId === id);
      if (cur) return ls.map((l) => (l.productId === id ? { ...l, ...patch } : l));
      return [...ls, { productId: id, level: "low", ...patch }];
    });
  };
  // Tap in the catalogue: onto your list (or, if it's there, show it).
  const tap = (p: P) => {
    if (!lineOf(p.id)) setLine(p.id, { level: "low", qty: waitingBy.get(p.id)?.qty || p.typical || 1 });
    // Side by side, show it in your list; on a phone (the list above the catalogue) stay where you are.
    if (window.matchMedia("(min-width: 760px)").matches) setTimeout(() => document.getElementById(`pick-${p.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  };
  const bump = (l: Line, d: number) => setLine(l.productId, { qty: Math.max(1, Math.min(MAX, Math.floor(l.qty ?? 0) + d)) });
  const missing = lines.filter((l) => l.qty === undefined).length;
  const total = lines.length + extras.length;
  // Clear all: empties the unsent list in one go (what's already on Stock needed stays).
  const clearAll = () => { setLines([]); setExtras([]); setNoIssues(false); setNoteOpen(undefined); setAdding(undefined); setClearing(false); setErr(""); };
  const addExtra = (x: Extra) => {
    setErr(""); setSent(undefined); setNoIssues(false);
    setExtras((xs) => [...xs.filter((o) => `${o.name}|${o.size ?? ""}`.toLowerCase() !== `${x.name}|${x.size ?? ""}`.toLowerCase()), x]);
    setAdding(undefined); setQuery("");
  };

  const submit = () => start(async () => {
    setErr("");
    const saved = await saveStockReport({ lines, noIssues, extras });
    if (!saved.ok) { setErr(saved.error); return; }
    const r = await sendStockReportNow();
    if (!r.ok) { setErr(r.error); return; }
    const bits = [r.created ? `${r.created} added` : "", r.again ? `${r.again} updated` : "", r.newItems ? `${r.newItems} new item${r.newItems === 1 ? "" : "s"} sent to the owner` : ""].filter(Boolean);
    setSent(total ? `Sent to Stock needed: ${bits.join(", ") || "done"}. It stays there until the buyer ticks it off.` : "Recorded: no stock issues today.");
    skipSave.current = true;
    setLines([]); setExtras([]); setNoIssues(false); setNoteOpen(undefined); setSaving("idle");
    router.refresh();
  });
  const saveWaiting = (productId: string, qty: number | null) => start(async () => {
    setErr("");
    const r = await editSiteNeededAction(productId, qty);
    if (!r.ok) setErr(r.error);
    router.refresh();
  });

  return (
    <main className="wide report-page">
      <div className="report-cols">
        <section className="report-cat stack" aria-label="Catalogue">
          <h2 className="h-sec" style={{ margin: 0 }}>Catalogue</h2>
          <div className="stock-tools">
            <input className="txt" type="search" placeholder="Search, e.g. lime" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="chips stock-cats" role="group" aria-label="Show">
              <button type="button" className={`chip ${cat === "all" && !q ? "done" : ""}`} onClick={() => setCat("all")}>All</button>
              {frequent.length > 0 && <button type="button" className={`chip ${cat === "frequent" && !q ? "done" : ""}`} onClick={() => setCat("frequent")}>Usual</button>}
              {cats.map((c) => <button key={c} type="button" className={`chip ${cat === c && !q ? "done" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          </div>
          {shown.length === 0 && <div className="card muted">{q ? `Nothing matches "${query}".` : "Nothing here yet."}</div>}
          <div className="stock-list">{shown.map(catRow)}</div>
          {adding
            ? <NewItemForm initial={adding} onAdd={addExtra} onCancel={() => setAdding(undefined)} />
            : (
              <div className="card stack" style={{ gap: 10 }}>
                <div className="strong">Not in the catalogue?</div>
                <div className="muted" style={{ fontSize: 14 }}>Add it as a new item. The owner adds it to the catalogue and orders it, and it&apos;s on the list next time.</div>
                <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAdding({ name: query.trim(), qty: 1 })}>
                  {q ? `Add “${query.trim()}” as a new item` : "Add a new item"}
                </button>
              </div>
            )}
          {canRepeat && (
            <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={() => start(async () => {
              const r = await repeatLastStockReport();
              if (!r.ok) { setErr(r.error); return; }
              window.location.reload();
            })}>Start from the last report</button>
          )}
        </section>

        <aside className="aside panel report-list" aria-label="Your list">
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <h2 className="h-sec grow" style={{ margin: 0 }}>Your list{total ? ` (${total})` : ""}</h2>
            {total > 0 && (clearing
              ? <>
                  <span className="strong" style={{ fontSize: 14 }}>Clear all {total}?</span>
                  <button type="button" className="btn small" onClick={clearAll}>Yes, clear</button>
                  <button type="button" className="btn ghost small" onClick={() => setClearing(false)}>Keep</button>
                </>
              : <button type="button" className="btn ghost small" onClick={() => setClearing(true)}>Clear all</button>)}
          </div>
          {sent && <div className="alert good" role="status" style={{ margin: 0 }}><Icon name="check" /><div className="grow">{sent}</div></div>}
          {!total && !sent && <div className="muted" style={{ fontSize: 14 }}>Tap what {siteName} needs in the catalogue. It shows here to check and change before you submit.</div>}
          {lines.map(pickRow)}
          {extras.map((x) => (
            <div key={`${x.name}|${x.size ?? ""}`} className="pick">
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="stock-qty">{x.qty !== undefined ? fmt(x.qty) : "?"}</span>
                <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="strong">{x.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{[x.size, x.note].filter(Boolean).join(" · ") || "Not in the catalogue yet"}</span>
                </span>
                <span className="chip warn">New item</span>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button type="button" className="btn ghost small" onClick={() => setAdding({ ...x })}>Change</button>
                <button type="button" className="btn ghost small" aria-label={`Take ${x.name} off`} onClick={() => setExtras((xs) => xs.filter((o) => o !== x))}>Take off</button>
              </div>
            </div>
          ))}
          {!total && (
            <button type="button" className={`btn ${noIssues ? "" : "ghost"}`} aria-pressed={noIssues} onClick={() => { setSent(undefined); setNoIssues(!noIssues); }}>
              {noIssues ? <><Icon name="check" />No stock issues today</> : "Checked: no stock issues today"}
            </button>
          )}
          {missing > 0 && <div className="err" role="alert">Say how many you need of {missing === 1 ? "one item" : `${missing} items`} before submitting.</div>}
          {err && <div className="err" role="alert">{err}</div>}
          <div className="report-submit">
            <span className="muted grow" style={{ fontSize: 13 }}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved: finish any time" : saving === "error" ? "Not saved" : ""}</span>
            <button type="button" className="btn accent" disabled={pending || missing > 0 || (!total && !noIssues)} onClick={submit}>
              {pending ? "Submitting…" : total ? `Submit ${total} item${total === 1 ? "" : "s"}` : "Submit: no stock issues"}
            </button>
          </div>

          {waiting.length > 0 && (
            <section className="stack" aria-label="Already on Stock needed" style={{ gap: 8 }}>
              <div className="stock-ticked-head muted">Already on Stock needed ({waiting.length})</div>
              <div className="muted" style={{ fontSize: 13 }}>Stays here until the buyer ticks it off.{canEditWaiting ? " Change an amount or remove what's no longer needed." : ""}</div>
              {waiting.map(waitRow)}
            </section>
          )}
        </aside>
      </div>
    </main>
  );

  function catRow(p: P) {
    const l = lineOf(p.id);
    const w = waitingBy.get(p.id);
    const already = openBy.get(p.id);
    return (
      <div key={p.id} className={`stock-item ${l ? "on" : ""} ${l?.level === "out" ? "out" : ""}`}>
        <button type="button" className="stock-head" aria-pressed={!!l} onClick={() => tap(p)}>
          <span className="mark" aria-hidden="true">{l ? (l.level === "out" ? "!" : "✓") : "+"}</span>
          <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
            <span className="strong">{p.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{p.size ?? "each"}{w ? ` · on Stock needed: ${w.unknown ? "?" : fmt(w.qty)}` : already ? ` · ${already.toLowerCase()}` : ""}</span>
          </span>
          {l && <span className={`chip ${l.level === "out" || l.qty === undefined ? "bad" : "warn"}`}>{l.qty !== undefined ? fmt(l.qty) : "?"}</span>}
        </button>
      </div>
    );
  }

  function pickRow(l: Line) {
    const p = byId.get(l.productId);
    if (!p) return null;
    const w = waitingBy.get(p.id);
    const open = noteOpen === p.id || !!l.note || !!l.photoId;
    return (
      <div key={p.id} id={`pick-${p.id}`} className={`pick ${l.level === "out" ? "out" : ""}`}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="strong">{p.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{p.size ?? "each"}</span>
          </span>
          <button type="button" className="btn ghost small" aria-label={`Take ${p.name} off`} onClick={() => setLine(p.id, null)}>Remove</button>
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <div className="stepper" role="group" aria-label={`${p.name}: how many`}>
            <button type="button" aria-label={`One less ${p.name}`} onClick={() => bump(l, -1)}>−</button>
            <input className="txt" inputMode="decimal" aria-label={`How many ${p.name}`} value={l.qty !== undefined ? fmt(l.qty) : ""} placeholder="0"
              onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setLine(p.id, { qty: e.target.value.trim() === "" || !Number.isFinite(n) || n <= 0 ? undefined : Math.min(MAX, n) }); }} />
            <button type="button" aria-label={`One more ${p.name}`} onClick={() => bump(l, 1)}>+</button>
          </div>
          <button type="button" className={`chip ${l.level === "out" ? "bad" : ""}`} aria-pressed={l.level === "out"}
            onClick={() => setLine(p.id, { level: l.level === "out" ? "low" : "out" })}>{l.level === "out" ? "Urgent: run out" : "Urgent?"}</button>
          {!open && <button type="button" className="chip" onClick={() => setNoteOpen(p.id)}>Note / photo</button>}
        </div>
        {w && <div className="muted" style={{ fontSize: 13 }}>Already on Stock needed: {w.unknown ? "no amount" : fmt(w.qty)}. {w.editable ? "Submitting replaces it with this amount." : "That one is being ordered, so this is asked for as well."}</div>}
        {p.typical !== undefined && l.qty !== p.typical && !w && <button type="button" className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setLine(p.id, { qty: p.typical })}>Usually {fmt(p.typical)}: use that</button>}
        {open && (
          <div className="stack" style={{ gap: 8 }}>
            <input className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={200} placeholder="Note (optional), e.g. half a box left" aria-label={`Note for ${p.name}`} value={l.note ?? ""} onChange={(e) => setLine(p.id, { note: e.target.value })} />
            <label className="btn ghost small" style={{ cursor: uploading ? "progress" : "pointer", alignSelf: "flex-start" }}>
              <Icon name="camera" />{uploading === p.id ? "Uploading…" : l.photoId ? "Photo added · change" : "Add a photo"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={!!uploading} onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                setUploading(p.id);
                try { const ph = await upload(f, "stock"); setLine(p.id, { photoId: ph.id }); } catch (x) { setErr((x as Error).message); }
                setUploading(undefined);
              }} />
            </label>
          </div>
        )}
      </div>
    );
  }

  function waitRow(w: Waiting) {
    const ed = editing?.id === w.productId ? editing : null;
    const n = ed ? Number(ed.value.replace(",", ".")) : NaN;
    const ok = !!ed && ed.value.trim() !== "" && Number.isFinite(n) && n > 0 && n <= MAX;
    const can = canEditWaiting && w.editable;
    return (
      <div key={w.productId} className="pick waiting">
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="stock-qty">{w.unknown ? "?" : fmt(w.qty)}</span>
          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="strong">{w.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{[w.pack, w.supplier, w.status].filter(Boolean).join(" · ")}</span>
          </span>
          {w.urgent && <span className="chip bad">Urgent</span>}
        </div>
        {can && !ed && removing !== w.productId && (
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => { setRemoving(null); setEditing({ id: w.productId, value: w.unknown ? "" : fmt(w.qty) }); }}>Change amount</button>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => { setEditing(null); setRemoving(w.productId); }}>Remove</button>
          </div>
        )}
        {ed && (
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className="stepper">
              <button type="button" aria-label="One less" disabled={pending || !(n > 1)} onClick={() => setEditing({ id: w.productId, value: fmt(Math.max(1, Math.ceil(n) - 1)) })}>−</button>
              <input className="txt" inputMode="decimal" aria-label={`New amount of ${w.name}`} value={ed.value} onChange={(e) => setEditing({ id: w.productId, value: e.target.value })} />
              <button type="button" aria-label="One more" disabled={pending || n >= MAX} onClick={() => setEditing({ id: w.productId, value: fmt(Number.isFinite(n) ? Math.floor(n) + 1 : 1) })}>+</button>
            </span>
            <button type="button" className="btn small" disabled={!ok || pending || (!w.unknown && n === w.qty)} onClick={() => saveWaiting(w.productId, n)}>Save</button>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        )}
        {removing === w.productId && (
          <div className="fix warn" role="alert" style={{ margin: 0 }}>
            <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
              <strong className="grow">Remove {w.unknown ? "" : `${fmt(w.qty)} × `}{w.name} from Stock needed?</strong>
              <button type="button" className="btn small" disabled={pending} onClick={() => saveWaiting(w.productId, null)}>Yes, remove</button>
              <button type="button" className="btn ghost small" disabled={pending} onClick={() => setRemoving(null)}>Keep it</button>
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
          onClick={() => onAdd({ name: name.trim().replace(/\s+/g, " "), ...(size.trim() ? { size: size.trim() } : {}), qty: Math.round(n * 100) / 100, ...(note.trim() ? { note: note.trim() } : {}) })}>Add to my list</button>
      </div>
    </div>
  );
}
