import Link from "next/link";
import { Icon } from "@/components/Icon";

export interface ManageCounts { timeOffPending?: number; certIssues?: number; noticesActive?: number; equipmentIssues?: number; urgent?: number; coverToDo?: number; libraryToDo?: number; recipesToDo?: number; trainingToDo?: number }

const TILES = [
  { href: "/manage/tasks", icon: "prep", title: "Task centre", text: "Everything open at your sites in one list, most urgent first", count: "urgent" as const, countLabel: "urgent" },
  { href: "/manage/report", icon: "report", title: "Weekly report", text: "Checks, temperatures, handovers and hours per site" },
  { href: "/manage/records", icon: "records", title: "Inspection records", text: "Temperature logs, sign-offs and corrective actions to show an inspector" },
  { href: "/library", icon: "book", title: "SOPs", text: "Write, approve and publish SOPs, and see who has read them", count: "libraryToDo" as const, countLabel: "to do" },
  { href: "/library/recipes", icon: "prep", title: "Recipes and allergens", text: "Prep recipes and dishes to write and approve; who has seen an allergen change", count: "recipesToDo" as const, countLabel: "to do" },
  { href: "/manage/notices", icon: "notice", title: "Team notices", text: "Post a notice and see who has read it", count: "noticesActive" as const, countLabel: "live" },
  { href: "/manage/time-off", icon: "timeoff", title: "Time off", text: "Holiday requests to approve or decline", count: "timeOffPending" as const, countLabel: "to decide" },
  { href: "/manage/handover-list", icon: "handover", title: "Handover list", text: "The things to do and to prep the closing shift picks from" },
  { href: "/manage/cover", icon: "handover", title: "Shift cover", text: "Who can cover a shift: approve, then update the rota sheet", count: "coverToDo" as const, countLabel: "to do" },
  { href: "/manage/training", icon: "book", title: "Training", text: "Skills passports: confirm hands-on skills, see who's overdue", count: "trainingToDo" as const, countLabel: "to do" },
  { href: "/manage/certificates", icon: "cert", title: "Certificates", text: "Food hygiene, allergens, first aid and expiry dates", count: "certIssues" as const, countLabel: "need attention" },
  { href: "/manage/equipment", icon: "wrench", title: "Equipment", text: "Faults, repairs, servicing and QR labels", count: "equipmentIssues" as const, countLabel: "to sort" },
];
/** The owner's own tools, after the shared ones. */
const OWNER_TILES = [
  { href: "/manage/checklists", icon: "records", title: "Checklists", text: "The opening, closing, cleaning and temperature checks: due times, and new versions of the checks" },
];

/** The manager's tools, shown on the Manage tab and at the top of the Owner screen. */
export function ManageTiles({ counts = {}, owner = false }: { counts?: ManageCounts; owner?: boolean }) {
  const tiles: (typeof TILES[number] | typeof OWNER_TILES[number])[] = owner ? [...TILES, ...OWNER_TILES] : TILES;
  return (
    <nav className="tiles" aria-label="Manager tools">
      {tiles.map((t) => {
        const n = "count" in t && t.count ? counts[t.count] ?? 0 : 0;
        return (
          <Link key={t.href} href={t.href} className="tile">
            <span className="row" style={{ gap: 10 }}>
              <span className="tile-ico"><Icon name={t.icon} /></span>
              {n > 0 && "count" in t && <span className={`chip ${t.count === "noticesActive" ? "done" : "late"}`} style={{ marginLeft: "auto" }}>{n} {t.countLabel}</span>}
            </span>
            <span className="grow">
              <span className="tile-title">{t.title}</span>
              <span className="muted">{t.text}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** What's waiting for a manager, most pressing first: the counts that need a decision or a hand, as a strip above the tiles. */
export function NeedsYou({ counts }: { counts: ManageCounts }) {
  const items = [
    { n: counts.urgent, href: "/manage/tasks", label: "urgent in the task centre", tone: "bad" },
    { n: counts.coverToDo, href: "/manage/cover", label: "cover requests to decide", tone: "" },
    { n: counts.timeOffPending, href: "/manage/time-off", label: "time-off requests to decide", tone: "" },
    { n: counts.trainingToDo, href: "/manage/training", label: "training things to do", tone: "" },
    { n: counts.certIssues, href: "/manage/certificates", label: "certificates need attention", tone: "" },
    { n: counts.libraryToDo, href: "/library", label: "SOPs to approve or finish", tone: "" },
    { n: counts.recipesToDo, href: "/library/recipes", label: "recipes to approve or finish", tone: "" },
    { n: counts.equipmentIssues, href: "/manage/equipment", label: "kit faults or services to sort", tone: "" },
  ].filter((i) => (i.n ?? 0) > 0).slice(0, 4);
  if (!items.length) return <div className="card muted">Nothing waiting for you right now.</div>;
  return (
    <div className="needs-you">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`alert ${i.tone}`} style={{ textDecoration: "none", padding: "10px 14px" }}>
          <span className="stat" style={{ fontSize: 30, color: "inherit" }}>{i.n}</span>
          <span className="grow strong" style={{ fontSize: 14 }}>{i.label}</span>
        </Link>
      ))}
    </div>
  );
}
