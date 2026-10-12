import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { mustRead, type LibraryDoc } from "@/lib/domain/library";
import type { Person } from "@/lib/domain/types";

/** Read-only: the published SOPs this person still has to read (rules in src/lib/domain/library.ts). */
export async function sopsToRead(person: Pick<Person, "id" | "status" | "access">, db: Store = store()): Promise<LibraryDoc[]> {
  const [docs, acks, sites] = await Promise.all([db.libraryDocs("sop"), db.libraryAcks({ personId: person.id }), db.sites()]);
  return mustRead(person, docs, new Set(acks.map((a) => a.versionId)), sites);
}
