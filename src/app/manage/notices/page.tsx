import { store } from "@/lib/data";
import { audienceLabel, canPostTo, isLive, readStats } from "@/lib/domain/notices";
import { sectionsFor } from "@/lib/domain/staff";
import { londonDate, shortDay } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { NoticeForm } from "./NoticeForm";
import { TakeDown } from "./TakeDown";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Post notices to the team and see who has read them. Owners and managers, for the sites they run. */
export default async function Notices() {
  const ctx = await requireManager();
  const db = store();
  const today = londonDate(Date.now());
  const [allSites, notices, people] = await Promise.all([db.sites(), db.teamNotices(15), db.people()]);
  const open = allSites.filter((s) => s.status === "open");
  const mine = open.filter((s) => ctx.managed.includes(s.id));
  const names = new Map(allSites.map((s) => [s.id, s.name]));
  const visible = notices.filter((n) => !n.siteId || ctx.managed.includes(n.siteId));
  // Read receipts name only people at the sites this person manages.
  const inCare = ctx.isOwner ? people : people.filter((p) => p.access.some((a) => ctx.managed.includes(a.siteId)));
  const live = visible.filter((n) => isLive(n, today));
  const ended = visible.filter((n) => !isLive(n, today));

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">Manager tools</div><h1 className="h-display">Team notices</h1></div>
        <NoticeForm sites={mine.map((s) => ({ id: s.id, name: s.name, sections: sectionsFor(s.kind) }))} canAllSites={canPostTo(ctx.managed, open.map((s) => s.id), undefined)} today={today} />

        <section className="stack">
          <h2 className="h-sec">Showing now</h2>
          {live.length === 0 && <div className="card muted">No notices showing. Post one above: staff see it on the shop tablet and on their phones until they tap &quot;Got it&quot;.</div>}
          {live.map((n) => {
            const st = readStats(n, inCare);
            return (
              <div key={n.id} className="card stack" style={{ gap: 8 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  {n.important && <span className="chip bad">Important</span>}
                  <span className="muted grow">{audienceLabel(n, n.siteId ? names.get(n.siteId) : undefined)} · {n.createdByName} · {when(n.createdAt)}{n.showUntil ? ` · until ${shortDay(n.showUntil)}` : ""}</span>
                  <TakeDown id={n.id} title={n.title} />
                </div>
                <div className="strong" style={{ fontSize: 17 }}>{n.title}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                <div className="read-bar" aria-label={`Read by ${st.read.length} of ${st.audience}`}><i style={{ width: `${st.audience ? Math.round((st.read.length / st.audience) * 100) : 0}%` }} /></div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="strong" style={{ fontSize: 14 }}>Read by {st.read.length} of {st.audience}</span>
                  {st.unread.length > 0 && <span className="muted">· Not yet: {st.unread.map((u) => u.name).join(", ")}</span>}
                </div>
              </div>
            );
          })}
        </section>

        {ended.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Earlier notices ({ended.length})</summary>
            <div className="log" style={{ marginTop: 8 }}>
              {ended.map((n) => {
                const st = readStats(n, inCare);
                return <div key={n.id}><span className="grow">{n.title} <span className="muted">· {audienceLabel(n, n.siteId ? names.get(n.siteId) : undefined)} · {when(n.createdAt)}</span></span><span className="muted">read by {st.read.length}/{st.audience}</span></div>;
              })}
            </div>
          </details>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
