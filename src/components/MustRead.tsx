import Link from "next/link";
import { Icon } from "./Icon";
import { CHANGE_TEXT, type LibraryDoc } from "@/lib/domain/library";

/**
 * On Today and My shifts until done: SOPs to read, and dishes whose allergens changed (everyone at the dish's sites
 * confirms they've seen the change).
 */
export function MustRead({ docs, allergens = [] }: { docs: LibraryDoc[]; allergens?: LibraryDoc[] }) {
  if (!docs.length && !allergens.length) return null;
  return (
    <>
      {allergens.length > 0 && (
        <section className="alert bad" aria-label="Allergen changes" style={{ alignItems: "flex-start" }}>
          <Icon name="alert" />
          <div className="grow stack" style={{ gap: 8 }}>
            <div className="strong">{allergens.length === 1 ? "An allergen change to check" : `${allergens.length} allergen changes to check`}</div>
            {allergens.map((d) => (
              <Link key={d.id} href={`/library/allergens/${d.id}`} className="row wrap" style={{ gap: 8, color: "inherit" }}>
                <span className="grow" style={{ fontWeight: 600, textDecoration: "underline" }}>{d.published!.title}</span>
                <span className="chip">Allergens changed</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {docs.length > 0 && (
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
      )}
    </>
  );
}
