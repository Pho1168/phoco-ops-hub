import Link from "next/link";
import { MyRow, QuickAdd, type MyRowView } from "@/components/MyDay";

/** The owner's first thing on /owner: their Top 3 for today, how many are left, and a one-line add. */
export function MyDayCard({ top, left, more, carried }: { top: MyRowView[]; left: number; more: number; carried: number }) {
  return (
    <section className="card stack my-card" aria-label="My day">
      <div className="row wrap">
        <h2 className="h-sec grow">My day</h2>
        {carried > 0 && <span className="chip late">{carried} carried over</span>}
        <span className={`chip ${left ? "warn" : "done"}`}>{left ? `${left} left today` : "Today's done"}</span>
      </div>
      {top.length ? (
        <ul className="my-list">{top.map((r) => <MyRow key={r.id} r={r} />)}</ul>
      ) : (
        <div className="muted">Nothing for today. Add one below, or open My Day to plan the week.</div>
      )}
      <QuickAdd />
      <Link className="btn ghost small" href="/owner/day" style={{ alignSelf: "flex-start" }}>Open My Day{more ? ` (${more} more today)` : ""}</Link>
    </section>
  );
}
