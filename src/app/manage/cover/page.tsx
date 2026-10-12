import { store } from "@/lib/data";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { withStates } from "@/lib/cover-service";
import { liveOffers, STATE_TEXT, type CoverState } from "@/lib/domain/cover";
import { sectionName } from "@/lib/domain/reminders";
import { shortDay } from "@/lib/domain/time";
import { CoverDecide } from "./CoverDecide";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const CHIP: Record<CoverState, string> = { open: "warn", expired: "bad", approved: "late", done: "done", declined: "", withdrawn: "" };

/** Shift cover at the sites a manager runs: approve an offer, then move the shift in the rota sheet. */
export default async function CoverPage() {
  const ctx = await requireManager();
  const db = store();
  const now = Date.now();
  const all = await withStates(await db.coverRequests({ siteIds: ctx.managed, since: now - 21 * 86_400_000 }), now);
  const toDecide = all.filter((r) => r.state === "open").sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const rota = all.filter((r) => r.state === "approved");
  const recent = all.filter((r) => !toDecide.includes(r) && !rota.includes(r)).slice(0, 20);
  const multiSite = ctx.managed.length > 1;
  const head = (r: (typeof all)[number]) => (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="strong grow" style={{ fontSize: 17 }}>{r.personName}</span>
        <span className="chip">{sectionName(r.section)}</span>
        {multiSite && <span className="chip">{r.siteName}</span>}
      </div>
      <div className="stat" style={{ fontSize: 26 }}>{shortDay(r.date)} · {r.start}–{r.end}</div>
      {r.note && <div style={{ whiteSpace: "pre-wrap" }}>&ldquo;{r.note}&rdquo;</div>}
    </>
  );

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">Manager tools</div><h1 className="h-display">Shift cover</h1></div>

        <section className="stack">
          <h2 className="h-sec">To decide ({toDecide.length})</h2>
          {toDecide.length === 0 && <div className="card muted">Nothing waiting. Staff ask from My shifts; colleagues in the same section who aren&apos;t working then are asked to offer.</div>}
          {toDecide.map((r) => {
            const offers = liveOffers(r);
            return (
              <div key={r.id} className="card stack" style={{ gap: 10 }}>
                {head(r)}
                <div className="muted">Asked {when(r.createdAt)} · {offers.length ? `${offers.length} offer${offers.length > 1 ? "s" : ""}: ${offers.map((o) => o.personName).join(", ")}` : "no offers yet"}</div>
                <CoverDecide id={r.id} name={r.personName} offers={offers.map((o) => ({ personId: o.personId, name: o.personName }))} />
              </div>
            );
          })}
        </section>

        {rota.length > 0 && (
          <section className="stack">
            <h2 className="h-sec">Update the rota sheet ({rota.length})</h2>
            {rota.map((r) => (
              <div key={r.id} className="card stack" style={{ gap: 8 }}>
                {head(r)}
                <div className="alert"><div className="grow"><div className="strong" style={{ fontSize: 14 }}>Move this shift from {r.personName} to {r.coveredByName} in the {r.siteName} rota sheet</div>
                  <div style={{ fontSize: 13 }}>Approved by {r.decidedByName} {r.decidedAt ? when(r.decidedAt) : ""}. It shows as covered once the sheet has sent the change (every hour).</div></div></div>
              </div>
            ))}
          </section>
        )}

        <section className="stack">
          <h2 className="h-sec">Recent</h2>
          {recent.length === 0 && <div className="card muted">No cover requests in the last three weeks.</div>}
          {recent.map((r) => (
            <div key={r.id} className="card row wrap" style={{ gap: 8 }}>
              <div className="grow"><div className="strong">{r.personName} · {shortDay(r.date)} {r.start}–{r.end}</div>
                <div className="muted">{r.state === "done" ? `Covered by ${r.coveredByName}` : r.state === "declined" ? `Declined by ${r.decidedByName}${r.decisionNote ? `: "${r.decisionNote}"` : ""}` : r.state === "expired" ? "The shift started without cover" : "Withdrawn"}</div></div>
              <span className={`chip ${CHIP[r.state]}`}>{STATE_TEXT[r.state]}</span>
            </div>
          ))}
        </section>
      </main>
      <BottomNav ctx={ctx} current="manage" />
    </>
  );
}
