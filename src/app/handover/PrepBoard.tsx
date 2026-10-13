"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignHandover, prepEditDraft, prepSubmit, switchSite } from "@/app/actions";
import type { PickGroup } from "@/lib/domain/assign";
import { categoryLabel, filterPrep, PREP_CATEGORIES, PREP_SHIFTS, type PrepCategory, type PrepItem, type PrepShift } from "@/lib/domain/prep";
import { ForSelect, forLabelOf } from "./ForSelect";

/** A picked item: `assignee` is who it's for (`assigneeName` in case they're no longer on the list). */
export interface Pick { urgent: boolean; note?: string; assignee?: string; assigneeName?: string }
interface Props {
  siteId: string; siteName: string; sites: { id: string; name: string }[];
  items: PrepItem[]; shift: PrepShift; picks: Record<string, Pick>;
  /**
   * Still outstanding from the last handover: they carry over by themselves, staying with whoever they're for. `entryId`
   * is the item on that handover (changing who it's for changes it there); `forBy`: "by Minh, Tue 22:31".
   */
  carried: Record<string, Pick & { entryId: string; forBy?: string }>;
  draftBy?: string;
  /** Notes that go on this handover with the prep items. */
  notesGoing: number;
  /** Who can be picked, for each shift the handover can be for. */
  pickBy: Record<PrepShift, PickGroup[]>;
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
  const pickedIds = active.map((i) => i.id).filter((id) => picks[id]);
  const carriedIds = Object.keys(p.carried);
  const carriedOnly = carriedIds.filter((id) => !picks[id]);
  const neededCount = pickedIds.length + carriedOnly.length;
  const stocked = active.length - neededCount;
  const pickNow = p.pickBy[shift] ?? [];

  const save = async (change: Parameters<typeof prepEditDraft>[0], undo: () => void) => {
    setSaving((n) => n + 1); setErr("");
    try {
      const r = await prepEditDraft(change);
      if (!r.ok) { undo(); setErr(r.error); }
    } catch { undo(); setErr("No connection. That tap wasn't saved, try again"); }
    finally { setSaving((n) => n - 1); }
  };
  const toggle = (id: string) => {
    if (p.carried[id] && !picks[id]) return; // carries over by itself; who it's for is set on the review step
    const was = picks[id];
    setPicks((cur) => { const n = { ...cur }; if (was) delete n[id]; else n[id] = { urgent: false }; return n; });
    save({ itemId: id, needed: !was }, () => setPicks((cur) => { const n = { ...cur }; if (was) n[id] = was; else delete n[id]; return n; }));
  };
  const flag = (id: string, patch: Pick) => {
    const was = picks[id];
    setPicks((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
    save({ itemId: id, needed: true, urgent: patch.urgent, note: patch.note === undefined ? undefined : patch.note || null }, () => setPicks((cur) => ({ ...cur, [id]: was })));
  };
  /** Gives a picked item to someone (saved with the draft). */
  const assign = (id: string, to: string | null) => {
    const was = picks[id];
    if (!was) return;
    setPicks((cur) => ({ ...cur, [id]: { ...was, assignee: to ?? undefined, assigneeName: undefined } }));
    save({ itemId: id, needed: true, assignee: to }, () => setPicks((cur) => ({ ...cur, [id]: was })));
  };
  /**
   * Gives a carried item to someone: on the handover it's still waiting on, so the Handover tab shows it too, and it
   * carries over with them. (It isn't picked again: if it's done before this handover is sent, it simply drops off.)
   */
  const [carriedFor, setCarriedFor] = useState<Record<string, string | null>>({});
  const assignCarried = (id: string, to: string | null) => {
    const was = carriedFor[id];
    const undo = () => setCarriedFor((m) => { const n = { ...m }; if (was === undefined) delete n[id]; else n[id] = was; return n; });
    setErr(""); setCarriedFor((m) => ({ ...m, [id]: to })); setSaving((n) => n + 1);
    assignHandover({ kind: "prep", id: p.carried[id].entryId, to })
      .then((r) => { if (!r.ok) { undo(); setErr(r.error); } })
      .catch(() => { undo(); setErr("No connection. That change wasn't saved, try again"); })
      .finally(() => setSaving((n) => n - 1));
  };
  const pickShift = (s: PrepShift) => { const was = shift; setShift(s); save({ shift: s }, () => setShift(was)); };
  const go = (m: typeof mode) => { setMode(m); topRef.current?.scrollIntoView({ block: "start" }); };
  const submit = () => startSubmit(async () => {
    setErr("");
    const r = await prepSubmit();
    if (!r.ok) { setErr(r.error); return; }
    router.push("/handover?sent=1");
  });

  const header = (
    <div ref={topRef} className="stack" style={{ gap: 12, scrollMarginTop: 70 }}>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <div className="eyebrow"><Link href="/handover">Handover</Link> · {p.siteName} · prep</div>
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
    const neededIds = pickedIds.filter((id) => !p.carried[id]);
    const list = [...neededIds].sort((a, b) => Number(!!picks[b].urgent) - Number(!!picks[a].urgent));
    const carriedList = [...carriedIds].sort((a, b) => Number(!!p.carried[b].urgent) - Number(!!p.carried[a].urgent));
    const forPick = (id: string) => (
      <div className="for-pick" style={{ marginTop: 0 }}>
        <span>For</span>
        <ForSelect value={picks[id]?.assignee ?? ""} current={picks[id]?.assigneeName} pick={pickNow} label={forLabelOf(name.get(id) ?? id)} onChange={(to) => assign(id, to)} />
      </div>
    );
    const carriedPick = (id: string) => {
      const c = p.carried[id], changed = id in carriedFor;
      return (
        <div className="for-pick" style={{ marginTop: 0 }}>
          <span>For</span>
          <ForSelect value={(changed ? carriedFor[id] : c.assignee) ?? ""} current={c.assigneeName} pick={pickNow} label={forLabelOf(name.get(id) ?? id)} onChange={(to) => assignCarried(id, to)} />
          {c.forBy && !changed && c.assignee && <span className="by">{c.forBy}</span>}
        </div>
      );
    };
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
                  {forPick(id)}
                </li>
              ))}
            </ul>
          </section>
          {carriedList.length > 0 && (
            <section className="stack">
              <h2 className="h-sec">Carried over ({carriedList.length})</h2>
              <div className="muted">Not done from the last handover. These go on this handover by themselves, staying with whoever they&apos;re for unless you change it.</div>
              <ul className="prep-review">
                {carriedList.map((id) => (
                  <li key={id} className={p.carried[id].urgent ? "urgent" : ""}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="grow strong" style={{ fontSize: 15 }}>{name.get(id)}</span>
                      {p.carried[id].urgent && <span className="chip bad">Urgent</span>}
                    </div>
                    {p.carried[id].note && <div className="prep-note">{p.carried[id].note}</div>}
                    {carriedPick(id)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {p.notesGoing > 0 && (
            <div className="card muted">
              {p.notesGoing} note{p.notesGoing > 1 ? "s go" : " goes"} with this handover. <Link href="/handover">See or add notes</Link>
            </div>
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
        {Object.keys(p.carried).length > 0 && (
          <Link href="/handover" className="alert" style={{ textDecoration: "none" }}>
            <div className="grow"><div className="strong">{Object.keys(p.carried).length} still outstanding from the last handover</div>
              <div style={{ fontSize: 13 }}>They carry over by themselves. Tap to see them on the Handover tab.</div></div>
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
            const on = !!picks[i.id]; // picked while it was done, then put back: it can be taken off again here
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
