import Link from "next/link";
import { Icon } from "./Icon";
import { CHANGE_TEXT, type LibraryDoc } from "@/lib/domain/library";

/** "SOPs to read": on Today and My shifts until the person has read each one. */
export function MustRead({ docs }: { docs: LibraryDoc[] }) {
  if (!docs.length) return null;
  return (
    <section className="alert" aria-label="SOPs to read" style={{ alignItems: "flex-start" }}>
      <Icon name="book" />
      <div className="grow stack" style={{ gap: 8 }}>
        <div className="strong">{docs.length === 1 ? "1 SOP to read" : `${docs.length} SOPs to read`}</div>
        {docs.map((d) => (
          <Link key={d.id} href={`/library/${d.id}`} className="row wrap" style={{ gap: 8, color: "inherit" }}>
            <span className="grow" style={{ fontWeight: 600, textDecoration: "underline" }}>{d.published!.title}</span>
            <span className="chip">{CHANGE_TEXT[d.published!.change ?? "new"]}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
