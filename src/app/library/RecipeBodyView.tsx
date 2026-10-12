import Image from "next/image";
import type { DishBody, PrepBody, RecipeKind } from "@/lib/domain/recipes";
import { StepList } from "./SopView";
import { AllergenCard } from "./RecipeParts";
import { ErasePhoto } from "./[id]/SopButtons";
import { StepMode } from "./[id]/StepMode";
import { Scaler } from "./[id]/Scaler";

/**
 * A recipe's content: the finished photo, batch facts (prep), the ingredients or a portion's components at any size,
 * the method, notes and allergens. `links`: linked prep recipes; `gone`: photos the owner erased; `eraseIn`: the owner
 * may erase photos; `stepMode`: offer step by step.
 */
export function RecipeBodyView({ kind, title, body, links, gone, eraseIn, stepMode }: {
  kind: RecipeKind; title: string; body: PrepBody | DishBody; links: Record<string, { title: string; code: string; live: boolean }>;
  gone: string[]; eraseIn?: string; stepMode?: boolean;
}) {
  const prep = kind === "prep" ? (body as PrepBody) : undefined, dish = kind === "dish" ? (body as DishBody) : undefined;
  const photoGone = !!body.photo && gone.includes(body.photo.id);
  return (
    <>
      {body.photo && (photoGone
        ? <div className="photo-removed" role="img" aria-label="Finished photo: removed">Photo removed</div>
        : <div className="stack" style={{ gap: 6 }}>
            <Image className="sop-photo hero" src={`/api/media/${body.photo.id}`} width={body.photo.w} height={body.photo.h} alt={`${title}, finished`} unoptimized />
            {eraseIn && <div className="photo-tools"><ErasePhoto docId={eraseIn} mediaId={body.photo.id} label="the finished photo" /></div>}
          </div>)}

      {prep && (prep.makes || prep.shelfLife || prep.storage) && (
        <section className="card recipe-facts" aria-label="Batch, storage and shelf life">
          {prep.makes && <div><span className="muted">One batch makes</span><span className="strong">{prep.makes.qty} {prep.makes.unit}</span></div>}
          {prep.shelfLife && <div><span className="muted">Shelf life</span><span className="strong">{prep.shelfLife.qty} {prep.shelfLife.qty === 1 ? prep.shelfLife.unit.replace(/s$/, "") : prep.shelfLife.unit}</span></div>}
          {prep.storage && <div><span className="muted">Storage</span><span className="strong">{prep.storage}</span></div>}
        </section>
      )}

      {dish && !dish.components.length && !dish.steps.length
        ? <div className="card muted" role="note">What goes in a portion and how it&apos;s built aren&apos;t written yet: only its allergens are.</div>
        : <>
            {(prep || dish!.components.length > 0) && <Scaler kind={kind} items={prep ? prep.ingredients : dish!.components} makes={prep?.makes} links={links} />}
            {body.steps.length > 0 && (
              <section className="stack" aria-label={kind === "prep" ? "Method" : "How it's built"}>
                <div className="row wrap"><h2 className="h-sec grow">{kind === "prep" ? "Method" : "How it's built"}</h2>
                  {stepMode && <StepMode title={title} steps={body.steps.map((s) => (s.photo && gone.includes(s.photo.id) ? { text: s.text, warning: s.warning } : s))} />}</div>
                <StepList steps={body.steps} title={title} erased={gone} eraseIn={eraseIn} />
              </section>
            )}
          </>}

      {prep?.notes && <section className="card stack" aria-label="Notes"><h2 className="h-sec">Notes</h2><div style={{ whiteSpace: "pre-wrap" }}>{prep.notes}</div></section>}

      <AllergenCard allergens={body.allergens} modifications={dish?.modifications} dietary={dish?.dietary} />
    </>
  );
}
