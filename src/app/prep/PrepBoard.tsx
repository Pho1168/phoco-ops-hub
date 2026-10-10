"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepEditDraft, prepSubmit, switchSite } from "@/app/actions";
import { categoryLabel, filterPrep, PREP_CATEGORIES, PREP_SHIFTS, type PrepCategory, type PrepItem, type PrepShift } from "@/lib/domain/prep";

export interface Pick { urgent: boolean; note?: string }
interface Props {
  siteId: string; siteName: string; sites: { id: string; name: string }[];
  items: PrepItem[]; shift: PrepShift; picks: Record<string, Pick>;
  /** Still outstanding from the last handover: they carry over by themselves. */
  carried: Record<string, Pick>;
  draftBy?: string; latestId?: string;
}

export function PrepBoard(p: Props) {
  const router = useRouter();
  const [shift, setShift] = useState<PrepShift>(p.shift);
  const [picks, setPicks] = useState<Record<string, Pick>>(p.picks);
  const [cat, setCat] = useState<PrepCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"pick" | "review">("pick");
  const [saving, setSaving] = useState(0);
  const [err, setErr] = useState("");
  const [submitting, startSubmit] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => filterPrep(p.items, cat, query), [p.items, cat, query]);
  const active = p.items.filter((i) => i.active);
  const name = new Map(p.items.map((i) => [i.id, i.name]));
  const neededIds = active.map((i) => i.id).filter((id) => picks[id]);
  const carriedOnly = Object.keys(p.carried).filter((id) => !picks[id]);
  const neededCount = neededIds.length + carriedOnly.length;
  const stocked = active.length - neededCount;

  const save = async (change: Parameters<typeof prepEditDraft>[0], undo: () => void) => {
    setSaving((n) => n + 1); setErr("");
    try {
      const r = await prepEditDraft(change);
      if (!r.ok) { undo(); setErr(r.error); }
    } catch { undo(); setErr("No connection. That tap wasn't saved, try again"); }
    finally { setSaving((n) => n - 1); }
  };
  const toggle = (id: string) => {
    if (p.carried[id] && !picks[id]) return;
    const was = picks[id];
    setPicks((cur) => { const n = { ...cur }; if (was) delete n[id]; else n[id] = { urgent: false }; return n; });
    save({ itemId: id, needed: !was }, () => setPicks((cur) => { const n = { ...cur }; if (was) n[id] = was; else delete n[id]; return n; }));
  };
  const flag = (id: string, patch: Pick) => {
    const was = picks[id];
    setPicks((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
    save({ itemId: id, needed: true, urgent: patch.urgent, note: patch.note === undefined ? undefined : patch.note || null }, () => setPicks((cur) => ({ ...cur, [id]: was })));
  };
  const pickShift = (s: PrepShift) => { const was = shift; setShift(s); save({ shift: s }, () => setShift(was)); };
  const go = (m: typeof mode) => { setMode(m); topRef.current?.scrollIntoView({ block: "start" }); };
  const submit = () => startSubmit(async () => {
    setErr("");
    const r = await prepSubmit();
    if (!r.ok) { setErr(r.error); return; }
    router.push(`/prep/report?id=${r.id}&sent=1`);
  });

  const header = (
    <div ref={topRef} className="stack" style={{ gap: 12, scrollMarginTop: 70 }}>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <div className="eyebrow"><Link href="/today">Today</Link> · {p.siteName} · kitchen prep handover</div>
          <h1 className="h-display">{mode === "pick" ? "What's needed?" : "Check and send"}</h1>
        </div>
        {p.sites.length > 1 && (
          <label className="row" style={{ gap: 8 }}><span className="muted">Site</span>
            <select value={p.siteId} onChange={(e) => switchSite(e.target.value)}>{p.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
        )}
      </div>
      <div className="seg" role="group" aria-label="Handover for">
        {PREP_SHIFTS.map((s) => <button key={s.id} type="button" aria-pressed={shift === s.id} onClick={() => pickShift(s.id)}>{s.label}</button>)}
      </div>
    </div>
  );

  if (mode === "review") {
    const list = [...neededIds].sort((a, b) => Number(!!picks[b].urgent) - Number(!!picks[a].urgent));
    return (
      <>
        <main>
          {header}
          <section className="stack">
            <h2 className="h-sec">Needed ({neededIds.length})</h2>
            {list.length === 0 && <div className="card muted">Nothing picked. That&apos;s fine if everything is stocked.</div>}
            <ul className="prep-review">
              {list.map((id) => (
                <li key={id} className={picks[id].urgent ? "urgent" : ""}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="grow strong" style={{ fontSize: 15 }}>{name.get(id)}</span>
                    <button type="button" className="flag" aria-pressed={!!picks[id].urgent} onClick={() => flag(id, { urgent: !picks[id].urgent })}>Urgent</button>
                    <button type="button" className="flag ghost" aria-label={`Remove ${name.get(id)}`} onClick={() => toggle(id)}>Remove</button>
                  </div>
                  <input className="txt note" maxLength={200} placeholder="Note (optional), e.g. only half a tub left" defaultValue={picks[id].note ?? ""}
                    aria-label={`Note for ${name.get(id)}`}
                    onBlur={(e) => { if ((e.target.value.trim() || undefined) !== (picks[id].note || undefined)) flag(id, { urgent: picks[id].urgent, note: e.target.value.trim() }); }} />
                </li>
              ))}
            </ul>
          </section>
          {carriedOnly.length > 0 && (
            <section className="stack">
              <h2 className="h-sec">Carried over ({carriedOnly.length})</h2>
              <div className="card muted">Not done from the last handover. These go on this handover by themselves: {carriedOnly.map((id) => name.get(id)).join(", ")}.</div>
            </section>
          )}
          <div className="card stack confirm-box">
            <div className="strong">The other {stocked} item{stocked === 1 ? " is" : "s are"} stocked</div>
            <div className="muted">Sending this handover records that you checked the rest of the list and nothing else is needed.</div>
          </div>
          {err && <div className="err" role="alert">{err}</div>}
        </main>
        <div className="sticky-foot"><div className="inner">
          <button className="btn ghost" type="button" onClick={() => go("pick")}>Back</button>
          <button className="btn accent grow" type="button" disabled={submitting || saving > 0} onClick={submit}>
            {submitting ? "Sending…" : "Everything else is stocked · Send"}
          </button>
        </div></div>
      </>
    );
  }

  let lastCat: PrepCategory | null = null;
  return (
    <>
      <main>
        {header}
        {p.latestId && Object.keys(p.carried).length > 0 && (
          <Link href={`/prep/report?id=${p.latestId}`} className="alert" style={{ textDecoration: "none" }}>
            <div className="grow"><div className="strong">{Object.keys(p.carried).length} still outstanding from the last handover</div>
              <div style={{ fontSize: 13 }}>They carry over by themselves. Tap to see the report.</div></div>
          </Link>
        )}
        <div className="prep-tools">
          <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value as PrepCategory | "all")}>
            <option value="all">All categories</option>
            {PREP_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input className="txt" type="search" placeholder="Search, e.g. oil" aria-label="Search prep items" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {p.draftBy && <div className="muted">Draft started by {p.draftBy}. Everyone on shift adds to the same list.</div>}
        {shown.length === 0 && <div className="card muted">Nothing matches &quot;{query}&quot;.</div>}
        <div className="prep-grid">
          {shown.map((i) => {
            const head = i.category !== lastCat ? <h2 key={`h-${i.category}`} className="h-sec prep-cat">{categoryLabel(i.category)}</h2> : null;
            lastCat = i.category;
            const on = !!picks[i.id];
            const carried = !on && !!p.carried[i.id];
            return [head, (
              <button key={i.id} type="button" className={`prep-item${on ? " on" : ""}${carried ? " carried" : ""}`} aria-pressed={on || carried}
                aria-disabled={carried || undefined} onClick={() => toggle(i.id)}>
                <span className="mark" aria-hidden="true">{on || carried ? "!" : ""}</span>
                <span className="grow">{i.name}</span>
                {on && <span className="chip late">{picks[i.id].urgent ? "Urgent" : "Needed"}</span>}
                {carried && <span className="chip warn">Outstanding</span>}
              </button>
            )];
          })}
        </div>
        {err && <div className="err" role="alert">{err}</div>}
      </main>
      <div className="sticky-foot"><div className="inner">
        <div className="prep-count" aria-live="polite"><b>{neededCount}</b><span>needed</span></div>
        <span className="muted grow">{saving > 0 ? "Saving…" : "Saved as a draft"}</span>
        <button className="btn accent" type="button" onClick={() => go("review")}>Review handover</button>
      </div></div>
    </>
  );
}
