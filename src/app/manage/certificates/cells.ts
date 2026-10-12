import type { CertKind, CertStatus, Certificate } from "@/lib/domain/certificates";
import { daysBetween } from "@/lib/domain/time";

/** Chip colour per status (classes from globals.css). */
export const CHIP: Record<CertStatus, string> = { valid: "done", expiring: "warn", expired: "bad", missing: "late", none: "" };

const monthYear = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** The few characters that fit in a matrix cell. The full words go in the cell's title. */
export function cellText(kind: CertKind, s: { status: CertStatus; cert?: Pick<Certificate, "expiresOn"> }, today: string): string {
  const exp = s.cert?.expiresOn;
  switch (s.status) {
    case "valid": return exp ? `✓ ${monthYear(exp)}` : "✓";
    case "expiring": { const d = daysBetween(today, exp!); return d <= 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`; }
    case "expired": return kind === "right_to_work" ? "Overdue" : "Expired";
    case "missing": return "Missing";
    case "none": return "–";
  }
}
