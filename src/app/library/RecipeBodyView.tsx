import Image from "next/image";
import { photoIds, type Photo } from "@/lib/domain/library";
import type { DishBody, PrepBody, RecipeKind } from "@/lib/domain/recipes";
import { AllergenCard } from "./RecipeParts";
import { RecipeCard } from "./RecipeCard";
import { ErasePhoto } from "./[id]/SopButtons";

/** Every photo in a recipe with what it shows, for the owner's privacy tool. */
function photosIn(body: PrepBody | DishBody): { photo: Photo; label: string }[] {
  const items = "ingredients" in body ? body.ingredients : body.components;
  const out: { photo: Photo; label: string }[] = [];
  if (body.photo) out.push({ photo: body.photo, label: "the finished photo" });
  items.forEach((it) => { if (it.photo) out.push({ photo: it.photo, label: `the picture of ${it.name}` }); });
  body.steps.forEach((s, i) => { if (s.photo) out.push({ photo: s.photo, label: `step ${i + 1}` }); });
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.photo.id) ? false : (seen.add(p.photo.id), true)));
}

/**
 * A recipe's content as its card (RecipeCard: one screen, like the printed recipe cards), then its allergens in words
 * (for reading in full). `links`: linked prep recipes; `gone`: photos the owner erased; `eraseIn`: the owner may erase
 * photos (a privacy tool, kept off the card); `stepMode`: offer step by step.
 */
export function RecipeBodyView({ kind, title, code, version, body, links, gone, eraseIn, stepMode, stamp }: {
  kind: RecipeKind; title: string; code: string; version?: number; body: PrepBody | DishBody; links: Record<string, { title: string; code: string; live: boolean }>;
  gone: string[]; eraseIn?: string; stepMode?: boolean;
  /** Set for anything but the version in use ("Draft: not approved", "Replaced version"): shown on the card, and it can't be printed. */
  stamp?: string;
}) {
  const dish = kind === "dish" ? (body as DishBody) : undefined;
  const erasable = eraseIn ? photosIn(body).filter((p) => !gone.includes(p.photo.id)) : [];
  return (
    <>
      <RecipeCard kind={kind} title={title} code={code} version={version} body={body} links={links} gone={gone} stepMode={stepMode} stamp={stamp} printable={!stamp} />
      <div className="rc-after">
        <AllergenCard allergens={body.allergens} modifications={dish?.modifications} dietary={dish?.dietary} />
        {eraseIn && erasable.length > 0 && photoIds(body).length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Erase a photo (privacy)</summary>
            <div className="rc-erase">
              {erasable.map((p) => (
                <div key={p.photo.id} className="stack" style={{ gap: 6 }}>
                  <Image className="thumb" src={`/api/media/${p.photo.id}`} width={p.photo.w} height={p.photo.h} alt={p.label} unoptimized />
                  <ErasePhoto docId={eraseIn} mediaId={p.photo.id} label={p.label} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  );
}
