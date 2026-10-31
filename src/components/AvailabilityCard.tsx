import Link from "next/link";
import { dueText, isLate } from "@/lib/domain/availability";
import { shortDay } from "@/lib/domain/time";

/** Next week's availability for the person: sent, to do, or overdue. On My shifts, and on the Owner screen for ops. */
export function AvailabilityCard({ week, sent, now }: { week: string; sent: boolean; now: number }) {
  const late = !sent && isLate(week, now);
  return (
    <Link href="/me/availability" className={`card row avail-link${late ? " avail-late" : ""}`} style={{ gap: 10, textDecoration: "none", color: "inherit" }}>
      <span className="grow stack" style={{ gap: 2 }}>
        <span className="strong">Availability · week of {shortDay(week)}</span>
        <span className="muted" style={{ fontSize: 14 }}>{sent ? "Sent. Tap to check or change it." : late ? "Overdue: say when you can work." : `Say when you can work, by ${dueText(week)}.`}</span>
      </span>
      <span className={`chip ${sent ? "done" : late ? "late" : "warn"}`}>{sent ? "Sent" : "To do"}</span>
    </Link>
  );
}
