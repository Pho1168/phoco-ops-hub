import Link from "next/link";
import { Icon } from "@/components/Icon";

export interface ManageCounts { timeOffPending?: number; certIssues?: number; noticesActive?: number; equipmentIssues?: number }

const TILES = [
  { href: "/manage/report", icon: "report", title: "Weekly report", text: "Checks, temperatures, handovers and hours per site" },
  { href: "/manage/records", icon: "records", title: "Inspection records", text: "Temperature logs, sign-offs and corrective actions to show an inspector" },
  { href: "/manage/notices", icon: "notice", title: "Team notices", text: "Post a notice and see who has read it", count: "noticesActive" as const, countLabel: "live" },
  { href: "/manage/time-off", icon: "timeoff", title: "Time off", text: "Holiday requests to approve or decline", count: "timeOffPending" as const, countLabel: "to decide" },
  { href: "/manage/certificates", icon: "cert", title: "Certificates", text: "Food hygiene, allergens, first aid and expiry dates", count: "certIssues" as const, countLabel: "need attention" },
  { href: "/manage/equipment", icon: "wrench", title: "Equipment", text: "Faults, repairs, servicing and QR labels", count: "equipmentIssues" as const, countLabel: "to sort" },
];

/** The manager's tools, shown on the Manage tab and at the top of the Owner screen. */
export function ManageTiles({ counts = {} }: { counts?: ManageCounts }) {
  return (
    <nav className="tiles" aria-label="Manager tools">
      {TILES.map((t) => {
        const n = t.count ? counts[t.count] ?? 0 : 0;
        return (
          <Link key={t.href} href={t.href} className="tile">
            <span className="tile-ico"><Icon name={t.icon} /></span>
            <span className="grow">
              <span className="strong" style={{ display: "block" }}>{t.title}</span>
              <span className="muted">{t.text}</span>
            </span>
            {n > 0 && <span className={`chip ${t.count === "noticesActive" ? "done" : "late"}`}>{n} {t.countLabel}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
