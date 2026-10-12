import type { TeamRowView } from "@/lib/team-today";

/** Today's shifts with each person's reminder and reply. For managers and the owner. */
export function TeamToday({ rows, showSite = false }: { rows: TeamRowView[]; showSite?: boolean }) {
  if (!rows.length) return <div className="muted">Nobody is on the published rota today.</div>;
  return (
    <ul className="accounts" aria-label="Team today">
      {rows.map((r) => (
        <li key={r.shiftId}>
          <div className="grow">
            <div className="strong">{r.name} <span className="muted">· {r.section}{showSite ? ` · ${r.site}` : ""}</span></div>
            <div className="muted">{r.time} · <span style={r.noteWarn ? { color: "var(--warn-ink)" } : undefined}>{r.note}</span></div>
          </div>
          {r.status && <span className={`chip ${r.status.tone}`}>{r.status.text}</span>}
        </li>
      ))}
    </ul>
  );
}
