"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface LibItem {
  id: string; code: string; title: string; who: string; sections: string[];
  /** For this person: still to read, or read. Undefined when it isn't for them. */
  read?: "todo" | "done";
  /** Writers only: the review date is near or past, or a new version is being written. */
  review?: "soon" | "overdue"; draft?: string;
}

const FILTERS = [["", "All"], ["FOH", "Front of house"], ["BOH", "Back of house"], ["PROD", "Production"]] as const;

/** The published SOPs, searchable by words in the title or the code, and filtered by section. */
export function LibraryList({ items, sections }: { items: LibItem[]; sections: string[] }) {
  const [q, setQ] = useState("");
  const [sec, setSec] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => (!sec || !i.sections.length || i.sections.includes(sec))
      && words.every((w) => i.title.toLowerCase().includes(w) || i.code.toLowerCase().includes(w)));
  }, [items, q, sec]);
  const filters = FILTERS.filter(([id]) => !id || sections.includes(id));

  return (
    <section className="stack" aria-label="SOPs">
      <input className="txt" style={{ width: "100%", maxWidth: "none" }} type="search" placeholder="Search SOPs" aria-label="Search SOPs" value={q} onChange={(e) => setQ(e.target.value)} />
      {filters.length > 2 && (
        <div className="seg" role="group" aria-label="Section">
          {filters.map(([id, label]) => <button key={id} type="button" aria-pressed={sec === id} onClick={() => setSec(id)}>{label}</button>)}
        </div>
      )}
      {shown.length === 0 && <div className="card muted">{items.length ? "No SOPs match." : "No SOPs published yet."}</div>}
      {shown.map((i) => (
        <Link key={i.id} href={`/library/${i.id}`} className="list-btn lib-item">
          <span className="grow">
            <span className="strong" style={{ display: "block" }}>{i.title}</span>
            <span className="muted"><span className="lib-code">{i.code}</span> · {i.who}</span>
          </span>
          <span className="chips">
            {i.read === "todo" && <span className="chip late">To read</span>}
            {i.read === "done" && <span className="chip done">Read</span>}
            {i.review && <span className={`chip ${i.review === "overdue" ? "bad" : "warn"}`}>{i.review === "overdue" ? "Review overdue" : "Review due"}</span>}
            {i.draft && <span className="chip">{i.draft}</span>}
          </span>
        </Link>
      ))}
    </section>
  );
}
