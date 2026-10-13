import type { Store } from "@/lib/data/store";
import { bySkillOrder, type Skill } from "@/lib/domain/training";
import type { LinkOption } from "./SkillForm";

const KIND = { sop: "SOP", prep: "Prep recipe", dish: "Dish" } as const;

/** SOPs, prep recipes and dishes a skill can link to (live ones, published or still being written), plus whatever it links to now. */
export async function linkOptions(db: Store, keep: string[] = []): Promise<LinkOption[]> {
  const [sops, preps, dishes] = await Promise.all([db.libraryDocs("sop", { light: true }), db.libraryDocs("prep", { light: true }), db.libraryDocs("dish", { light: true })]);
  return [...sops, ...preps, ...dishes]
    .filter((d) => (!d.retiredAt && (d.published || d.open)) || keep.includes(d.id))
    .map((d) => ({
      id: d.id, label: `${d.published?.title ?? d.open?.title ?? d.code} (${d.code})`, kind: KIND[d.kind],
      note: d.retiredAt ? "retired" : !d.published ? "not published yet" : undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The headings used in each pathway, in pathway order, for the heading box's suggestions. */
export function groupsBySection(skills: Skill[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of [...skills].filter((k) => !k.retiredAt).sort(bySkillOrder)) {
    const list = (out[s.section] ??= []);
    if (!list.includes(s.group)) list.push(s.group);
  }
  return out;
}
