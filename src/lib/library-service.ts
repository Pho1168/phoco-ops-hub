import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { mustRead, photoIds, type LibraryDoc } from "@/lib/domain/library";
import { allergenAlerts, type DishBody, type PrepBody } from "@/lib/domain/recipes";
import type { Person } from "@/lib/domain/types";

/** Read-only: the published SOPs this person still has to read (rules in src/lib/domain/library.ts). */
export async function sopsToRead(person: Pick<Person, "id" | "status" | "access">, db: Store = store()): Promise<LibraryDoc[]> {
  const [docs, acks, sites] = await Promise.all([db.libraryDocs("sop", { light: true }), db.libraryAcks({ personId: person.id }), db.sites()]);
  return mustRead(person, docs, new Set(acks.map((a) => a.versionId)), sites);
}

/** The photos in a body that the owner has erased (they show as removed). */
export async function erasedPhotos(body: Parameters<typeof photoIds>[0], db: Store = store()): Promise<string[]> {
  const ids = photoIds(body);
  if (!ids.length) return [];
  return Array.from((await db.mediaStatus(ids)).entries()).filter(([, m]) => m.erased).map(([id]) => id);
}

/** Where a dish's components link (prep recipes): title, code, and whether it's still in use. */
export async function recipeLinks(body: PrepBody | DishBody, db: Store = store()): Promise<Record<string, { title: string; code: string; live: boolean }>> {
  const items = "components" in body ? body.components : [];
  const ids = Array.from(new Set(items.flatMap((i) => (i.prep ? [i.prep] : []))));
  const docs = await Promise.all(ids.map((id) => db.libraryDoc(id)));
  return Object.fromEntries(docs.flatMap((d) => (d ? [[d.id, { title: d.published?.title ?? d.open?.title ?? d.code, code: d.code, live: !!d.published && !d.retiredAt }]] : [])));
}

/** Read-only: dishes whose allergen change this person still has to confirm (rules in src/lib/domain/recipes.ts). */
export async function allergenChangesToConfirm(person: Pick<Person, "id" | "status" | "access">, db: Store = store()): Promise<LibraryDoc<DishBody>[]> {
  const [dishes, acks, sites] = await Promise.all([db.libraryDocs("dish", { light: true }), db.libraryAcks({ personId: person.id }), db.sites()]);
  return allergenAlerts(person, dishes, acks, sites);
}
