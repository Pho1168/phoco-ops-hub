"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSkillDone } from "@/app/actions";

/** A skill with no quiz: "Mark it as done" (knowledge) or "I'm ready to be checked" (hands-on); "again" for a refresher. */
export function MarkDone({ skillId, handsOn, again = false }: { skillId: string; handsOn: boolean; again?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="btn accent" disabled={pending} onClick={() => start(async () => {
        setErr("");
        const r = await markSkillDone(skillId);
        if (!r.ok) setErr(r.error); else router.refresh();
      })}>{pending ? "Saving…" : handsOn ? `I'm ready to be checked${again ? " again" : ""}` : again ? "Mark it as done again" : "Mark it as done"}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
