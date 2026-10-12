import { store } from "@/lib/data";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { coverState, liveOffers, STATE_TEXT, type CoverRequest, type CoverState } from "@/lib/domain/cover";
import { sectionName, shiftStart } from "@/lib/domain/reminders";
import { shortDay } from "@/lib/domain/time";
import { CoverDecide } from "./CoverDecide";
import { CoverCancel } from "./CoverCancel";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const CHIP: Record<CoverState, string> = { open: "warn", expired: "bad", rota_changed: "", approved: "late", done: "done", past: "bad", declined: "", withdrawn: "", cancelled: "" };
const OUTCOME: Record<CoverState, (r: CoverRequest) => string> = {
  open: () => "", approved: () => "",
  expired: () => "The shift started without cover",
  rota_changed: () => "The rota sheet changed this shift before anyone was approved",
  done: (r) => `Covered by ${r.coveredByName}`,
  past: (r) => `${r.coveredByName} was approved, but the rota sheet wasn't changed`,
  declined: (r) => `Declined by ${r.decidedByName}${r.decisionNote ? `: "${r.decisionNote}"` : ""}`,
  withdrawn: () => "Withdrawn",
  cancelled: (r) => `${r.coveredByName}'s cover was cancelled by ${r.cancelledByName}${r.cancelNote ? `: "${r.cancelNote}"` : ""}`,
};

/** Shift cover at the sites a manager runs: approve an offer, then move the shift in the rota sheet. */
export default async function CoverPage() {
  const ctx = await requireManager();
  const db = store();
  const now = Date.now();
  // Requests for shifts that end after two weeks ago: everything still in play, and recent history.
  const all = (await db.coverRequests({ siteIds: ctx.managed, shiftEndsAfter: now - 14 * 86_400_000 })).map((r) => ({ ...r, state: coverState(r, now) }));
  const byStart = (a: CoverRequest, b: CoverRequest) => shiftStart(a) - shiftStart(b);
  const toDecide = all.filter((r) => r.state === "open").sort(byStart);
  const rota = all.filter((r) => r.state === "approved").sort(byStart);
  const recent = all.filter((r) => r.state !== "open" && r.state !== "approved").slice(0, 20);
  const multiSite = ctx.managed.length > 1;
  const head = (r: CoverRequest) => (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="strong grow" style={{ fontSize: 17 }}>{r.personName}</span>
        <span className="chip">{sectionName(r.section)}</span>
        {multiSite && <span className="chip">{r.siteName}</span>}
      </div>
      <div className="stat" style={{ fontSize: 26 }}>{shortDay(r.date)} · {r.start}–{r.end}</div>
      {r.note && <div style={{ whiteSpace: "pre-wrap" }}>&ldquo;{r.note}&rdquo; <span className="muted">(only managers see this)</span></div>}
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
                  <div style={{ fontSize: 13 }}>Approved by {r.decidedByName}{r.decidedAt ? ` ${when(r.decidedAt)}` : ""}. It shows as covered once the sheet has sent the change (every hour).</div></div></div>
                <CoverCancel id={r.id} name={r.personName} coverer={r.coveredByName ?? "the person covering"} />
              </div>
            ))}
          </section>
        )}

        <section className="stack">
          <h2 className="h-sec">Recent</h2>
          {recent.length === 0 && <div className="card muted">No cover requests for the last two weeks.</div>}
          {recent.map((r) => (
            <div key={r.id} className="card row wrap" style={{ gap: 8 }}>
              <div className="grow"><div className="strong">{r.personName} · {shortDay(r.date)} {r.start}–{r.end}</div>
                <div className="muted">{OUTCOME[r.state](r)}</div></div>
              <span className={`chip ${CHIP[r.state]}`}>{STATE_TEXT[r.state]}</span>
            </div>
          ))}
        </section>
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
