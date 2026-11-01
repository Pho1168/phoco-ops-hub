"use client";

import { useMemo, useState } from "react";
import { candidatesFor, draftRota, hoursOf, peopleOnDays, sheetRows, WEEKEND, WEEKEND_MIN, type DraftInput, type DraftSlot } from "@/lib/domain/rota-draft";
import type { AvailDay } from "@/lib/domain/availability";
import { shortDay } from "@/lib/domain/time";

type SerialInput = Omit<DraftInput, "availability"> & { availability: [string, AvailDay[]][] };
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The owner's rota draft: last week's shape filled from availability, read on a phone. Each shift has a Swap to pick
 * someone else who fits; Redraft starts again. Nothing here is saved: when it reads right, the owner types it into
 * the rota sheet from the "Like the sheet" view.
 */
export function DraftClient({ serial, siteName }: { serial: SerialInput; siteName: string }) {
  const input = useMemo<DraftInput>(() => ({ ...serial, availability: new Map(serial.availability) }), [serial]);
  const base = useMemo(() => draftRota(input), [input]);
  const [fills, setFills] = useState<Map<string, string>>(() => new Map(base.fills));
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "sheet">("grid");
  const slots = base.slots;
  const hours = hoursOf(slots, fills);
  const onDays = peopleOnDays(slots, fills);
  const name = (id?: string) => input.people.find((p) => p.id === id)?.name ?? "—";
  const gaps = slots.filter((s) => !fills.has(s.id));
  const reason = (s: DraftSlot) => base.gaps.find((g) => g.slotId === s.id)?.reason;

  const swap = (slot: DraftSlot, personId: string) => {
    setFills((cur) => { const next = new Map(cur); if (personId) next.set(slot.id, personId); else next.delete(slot.id); return next; });
    setOpen(null);
  };
  const rows = sheetRows({ slots, fills }, input.people);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>By day</button>
          <button type="button" aria-pressed={view === "sheet"} onClick={() => setView("sheet")}>Like the sheet</button>
        </div>
        <span className="grow" />
        <button type="button" className="btn ghost small" onClick={() => { setFills(new Map(base.fills)); setOpen(null); }}>Redraft</button>
      </div>

      {(gaps.length > 0 || base.noAnswer.length > 0) && (
        <section className="card stack" style={{ gap: 6, borderLeft: "4px solid var(--accent)" }}>
          {gaps.length > 0 && <div className="strong">{gaps.length} shift{gaps.length === 1 ? "" : "s"} nobody can take</div>}
          {gaps.map((s) => <div key={s.id} style={{ fontSize: 14 }}>{DAY[s.day]} {s.start}–{s.end} {s.section}: <span className="muted">{reason(s) ?? "nobody free"}</span></div>)}
          {base.noAnswer.length > 0 && <div className="muted" style={{ fontSize: 14 }}>Didn&apos;t send availability, so not put on: {base.noAnswer.map((p) => p.name).join(", ")}.</div>}
        </section>
      )}

      {view === "grid" && base.days.map((date, d) => {
        const onDay = slots.filter((s) => s.day === d);
        if (!onDay.length) return null;
        const weekend = WEEKEND.includes(d);
        const short = weekend && onDays[d] < (input.weekendMin ?? WEEKEND_MIN);
        return (
          <section key={date} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
              <h3 className="h-sec grow" style={{ margin: 0 }}>{shortDay(date)}</h3>
              <span className={`chip ${short ? "bad" : weekend ? "done" : ""}`}>{onDays[d]} on{weekend ? ` · need ${input.weekendMin ?? WEEKEND_MIN}` : ""}</span>
            </div>
            {onDay.map((s) => {
              const pid = fills.get(s.id);
              const isOpen = open === s.id;
              const { fit, unfit } = isOpen ? candidatesFor({ input, slots, fills, hours }, s) : { fit: [], unfit: [] };
              return (
                <div key={s.id} className="stack" style={{ gap: 6, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <span className="chip" style={{ minWidth: 44, justifyContent: "center" }}>{s.section}</span>
                    <span className="strong" style={{ minWidth: 112 }}>{s.start}–{s.end}</span>
                    <span className={`grow ${pid ? "" : "muted"}`}>{pid ? name(pid) : "— nobody —"}{s.added && <span className="muted" style={{ fontSize: 12 }}> · added for weekend cover</span>}</span>
                    <button type="button" className="btn ghost small" onClick={() => setOpen(isOpen ? null : s.id)}>{isOpen ? "Close" : "Swap"}</button>
                  </div>
                  {isOpen && (
                    <div className="stack" style={{ gap: 6, paddingLeft: 8 }}>
                      {fit.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Nobody else fits this shift.</div>}
                      <div className="row wrap" style={{ gap: 6 }}>
                        {fit.map((p) => (
                          <button key={p.id} type="button" className={`btn small ${p.id === pid ? "" : "ghost"}`} onClick={() => swap(s, p.id)}>
                            {p.name} <span className="muted" style={{ fontWeight: 400 }}>{fmt(hours.get(p.id) ?? 0)}h</span>
                          </button>
                        ))}
                        {pid && <button type="button" className="btn ghost small" onClick={() => swap(s, "")}>Leave empty</button>}
                      </div>
                      {unfit.length > 0 && <div className="muted" style={{ fontSize: 13 }}>Can&apos;t: {unfit.map((u) => `${u.person.name} (${u.why})`).join(", ")}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      {view === "sheet" && (
        <section className="card stack" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 14 }}>Type these into the {siteName} rota sheet. Blank break means an hour off, as the sheet assumes.</div>
          <div style={{ overflowX: "auto" }}>
            <table className="draft-sheet">
              <thead><tr><th>Name</th><th>Sec</th>{DAY.map((d) => <th key={d}>{d}</th>)}<th>Hrs</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.name}|${r.section}`}>
                    <td className="strong">{r.name}</td><td>{r.section}</td>
                    {r.days.map((x, i) => <td key={i}>{x}</td>)}
                    <td>{fmt(r.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card stack" style={{ gap: 4 }}>
        <div className="strong">Hours this draft</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {input.people.map((p) => <span key={p.id} className={`chip ${hours.get(p.id) ? "" : "muted"}`}>{p.name} {fmt(hours.get(p.id) ?? 0)}h</span>)}
        </div>
      </section>
    </div>
  );
}
