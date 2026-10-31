import Link from "next/link";
import { dueDay, dueText, isLate, AVAIL_DUE_AT } from "@/lib/domain/availability";
import { londonDate, shortDay } from "@/lib/domain/time";

/**
 * The person's availability for next week. Not sent: a banner for the top of the screen (amber; orange on the day it's
 * due and once it's overdue), one tap to the form. Sent: a quiet card to check or change it.
 */
export function AvailabilityCard({ week, sent, now }: { week: string; sent: boolean; now: number }) {
  if (sent) {
    return (
      <Link href="/me/availability" className="card row avail-link" style={{ gap: 10, textDecoration: "none", color: "inherit" }}>
        <span className="grow stack" style={{ gap: 2 }}>
          <span className="strong">Availability · week of {shortDay(week)}</span>
          <span className="muted" style={{ fontSize: 14 }}>Sent. Tap to check or change it.</span>
        </span>
        <span className="chip done">Sent</span>
      </Link>
    );
  }
  return <AvailabilityBanner week={week} now={now} />;
}

/** The top-of-screen reminder while next week's availability hasn't been sent. */
export function AvailabilityBanner({ week, now }: { week: string; now: number }) {
  const late = isLate(week, now);
  const today = !late && londonDate(now) === dueDay(week);
  return (
    <Link href="/me/availability" className={`avail-banner${late || today ? " urgent" : ""}`}>
      <span className="avail-banner-mark" aria-hidden="true">!</span>
      <span className="grow stack" style={{ gap: 2 }}>
        <span className="avail-banner-title">{late ? "Your availability is overdue" : today ? `Availability due today at ${AVAIL_DUE_AT}` : "Fill in your availability"}</span>
        <span className="avail-banner-sub">Week of {shortDay(week)} · {late ? `it was due ${dueText(week)}. Send it now.` : `due ${dueText(week)}.`}</span>
      </span>
      <span className="avail-banner-go">Fill it in</span>
    </Link>
  );
}
