import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canDraft, isKind } from "@/lib/domain/library";
import { alertedAt, allergenChanges, seesRecipes, type DishBody } from "@/lib/domain/recipes";
import { current } from "@/lib/session";
import { erasedPhotos } from "@/lib/library-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { AllergenCard, AllergenChanges } from "../../RecipeParts";
import { dayMonthYearAt } from "../../format";
import { AckButton } from "../../[id]/SopButtons";

export const dynamic = "force-dynamic";

/**
 * One dish's allergens, for everyone signed in (tablet or own phone): what it contains, what can be left out, kitchen
 * notes and dietary tags, and its last allergen change. Someone at the dish's sites who hasn't confirmed that change
 * confirms it here. Kitchen staff can open the full recipe.
 */
export default async function DishAllergens(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const doc = await db.libraryDoc(id);
  if (!doc || !isKind(doc, "dish")) notFound();
  const full = ctx.scope === "full";
  const v = doc.published;
  if (!v || (doc.retiredAt && !(full && canDraft(ctx.person)))) notFound();
  const sites = await db.sites();
  const changedAt = v.allergensChangedAt;
  const [versions, mine, gone] = await Promise.all([
    changedAt ? db.libraryVersions(doc.id) : Promise.resolve([]),
    db.libraryAcks({ docId: doc.id, personId: ctx.person.id }),
    erasedPhotos(v.body, db),
  ]);
  // What changed: the version that changed it against the one before.
  const changedIn = versions.find((x) => x.publishedAt === changedAt);
  const before = changedIn?.version ? versions.find((x) => x.version === changedIn.version! - 1) : undefined;
  const changes = changedIn && before ? allergenChanges((before.body as DishBody).allergens, (changedIn.body as DishBody).allergens) : [];
  const asked = !!changedAt && !doc.retiredAt && alertedAt(ctx.person, v.body.sections, sites).length > 0;
  const confirmed = changedAt ? mine.filter((a) => a.at >= changedAt).sort((a, b) => a.at - b.at)[0] : undefined;
  const kitchen = full && seesRecipes(ctx.person, sites);
  const photo = v.body.photo && !gone.includes(v.body.photo.id) ? v.body.photo : undefined;

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <Link href="/library/allergens" className="muted" style={{ fontWeight: 600 }}>← Allergens</Link>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{v.body.category || "Dish"} · <span className="lib-code">{doc.code}</span></div>
          <h1 className="h-display">{v.title}</h1>
          {doc.retiredAt && <div className="muted">Retired on {dayMonthYearAt(doc.retiredAt)}: no longer on the menu.</div>}
        </div>

        {changedAt && (
          <section className={`alert ${asked && !confirmed ? "bad" : ""}`} aria-label="Allergen change" style={{ alignItems: "flex-start" }}>
            <div className="grow stack" style={{ gap: 6 }}>
              <div className="strong">Allergens changed on {dayMonthYearAt(changedAt)}</div>
              {changes.length > 0 && <AllergenChanges changes={changes} />}
              {asked && (confirmed
                ? <div style={{ fontSize: 13 }}>You confirmed you&apos;ve seen it on {dayMonthYearAt(confirmed.at)}.</div>
                : <div className="stack" style={{ gap: 6 }}><div style={{ fontSize: 13 }}>Check the allergens below, then confirm. Your manager can see who has.</div>
                    <AckButton versionId={v.id} label="I've seen the change" /></div>)}
            </div>
          </section>
        )}

        <AllergenCard allergens={v.body.allergens} modifications={v.body.modifications} dietary={v.body.dietary} />
        {photo && <Image className="sop-photo hero" src={`/api/media/${photo.id}`} width={photo.w} height={photo.h} alt={`${v.title}, as served`} unoptimized />}
        {kitchen && <Link className="btn ghost" href={`/library/${doc.id}`}>Open the recipe</Link>}
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
