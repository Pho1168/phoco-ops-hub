"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { offerCover, withdrawOffer } from "@/app/actions";

export interface CoverOfferRow { id: string; who: string; when: string; where: string; offered: boolean }

/** Shifts colleagues want covered that I could do. */
export function CoverOffers({ rows }: { rows: CoverOfferRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);
  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setErr(null);
    const r = await fn();
    if (!r.ok) { setErr({ id, text: r.error ?? "That didn't work" }); return; }
    router.refresh();
  });
  if (!rows.length) return null;
  return (
    <section className="card stack" aria-label="Shifts you could cover" style={{ gap: 10 }}>
      <h2 className="h-sec">Shifts you could cover</h2>
      {rows.map((r) => (
        <div key={r.id} className="stack timeoff-row" style={{ gap: 6 }}>
          <div className="strong" style={{ fontSize: 15 }}>{r.when}</div>
          <div className="muted">{r.who} · {r.where}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {r.offered
              ? <><span className="chip done">You offered · your manager will decide</span><button type="button" className="btn ghost small" disabled={pending} onClick={() => run(r.id, () => withdrawOffer(r.id))}>Take back</button></>
              : <button type="button" className="btn accent small" disabled={pending} onClick={() => run(r.id, () => offerCover(r.id))}>I can cover</button>}
          </div>
          {err?.id === r.id && <div className="err" role="alert">{err.text}</div>}
        </div>
      ))}
    </section>
  );
}
