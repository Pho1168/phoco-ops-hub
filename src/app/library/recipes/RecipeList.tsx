"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface RecipeItem {
  id: string; code: string; title: string; kind: "prep" | "dish"; category: string;
  /** Writers only: the review date is near or past, or a new version is being written. */
  review?: "soon" | "overdue"; draft?: string;
}

const FILTERS = [["", "All"], ["prep", "Prep recipes"], ["dish", "Dishes"]] as const;

/** Published recipes, searchable by name, code or category, filtered by kind, grouped by category. */
export function RecipeList({ items }: { items: RecipeItem[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((i) => (!kind || i.kind === kind)
      && words.every((w) => i.title.toLowerCase().includes(w) || i.code.toLowerCase().includes(w) || i.category.toLowerCase().includes(w)));
    const out = new Map<string, { name: string; items: RecipeItem[] }>();
    for (const i of shown) {
      const key = `${i.kind}|${(i.category || "Other").toLowerCase()}`;
      if (!out.has(key)) out.set(key, { name: `${i.category || "Other"}${kind ? "" : i.kind === "prep" ? " · prep" : ""}`, items: [] });
      out.get(key)!.items.push(i);
    }
    return Array.from(out.values());
  }, [items, q, kind]);

  return (
    <section className="stack" aria-label="Recipes">
      <input className="txt" style={{ width: "100%", maxWidth: "none" }} type="search" placeholder="Search recipes" aria-label="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seg" role="group" aria-label="Kind">
        {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}
      </div>
      {groups.length === 0 && <div className="card muted">{items.length ? "No recipes match." : "No recipes published yet."}</div>}
      {groups.map((g) => (
        <div key={g.name} className="stack" style={{ gap: 8 }}>
          <h2 className="h-sec">{g.name}</h2>
          {g.items.map((i) => (
            <Link key={i.id} href={`/library/${i.id}`} className="list-btn lib-item">
              <span className="grow">
                <span className="strong" style={{ display: "block" }}>{i.title}</span>
                <span className="muted"><span className="lib-code">{i.code}</span> · {i.kind === "prep" ? "Prep recipe" : "Dish"}</span>
              </span>
              <span className="chips">
                {i.review && <span className={`chip ${i.review === "overdue" ? "bad" : "warn"}`}>{i.review === "overdue" ? "Review overdue" : "Review due"}</span>}
                {i.draft && <span className="chip">{i.draft}</span>}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </section>
  );
}
