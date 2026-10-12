import { LIGHT_TEXT, readyHeadline, type Ready } from "@/lib/domain/daily";

/** Ready to open: a green, amber or red light with what's in the way. */
export function ReadyLight({ r, site }: { r: Ready; site?: string }) {
  return (
    <div className={`alert ${r.light === "green" ? "good" : r.light === "red" ? "bad" : ""}`} role="status" aria-label={`${site ? `${site}: ` : ""}${LIGHT_TEXT[r.light]}`}>
      <span className={`light ${r.light}`} aria-hidden />
      <div className="grow">
        <div className="strong">{site ? `${site} · ` : ""}{readyHeadline(r)}</div>
        {r.reasons.length > 0 && <ul className="reasons">{r.reasons.map((x, i) => <li key={i}>{x.text}</li>)}</ul>}
      </div>
    </div>
  );
}
