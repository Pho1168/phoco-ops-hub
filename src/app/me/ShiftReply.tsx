"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyToShift } from "@/app/actions";

type Kind = "on_my_way" | "late" | "cant_make_it";
const THANKS: Record<Kind, string> = {
  on_my_way: "Thanks. See you soon.",
  late: "Thanks. Your manager can see this now.",
  cant_make_it: "Your manager can see this now. Please phone them as well.",
};

/** On my way (only before the shift starts) / Running late / Can't make it, under a shift that starts soon or is on now. */
export function ShiftReply({ shiftId, current, started = false }: { shiftId: string; current?: { text: string; tone: string }; started?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [late, setLate] = useState(false);
  const [err, setErr] = useState("");
  const [thanks, setThanks] = useState("");

  const send = (kind: Kind, lateMinutes?: 15 | 30 | 45) => start(async () => {
    setErr(""); setThanks("");
    const r = await replyToShift({ shiftId, kind, lateMinutes });
    if (!r.ok) { setErr(r.error); return; }
    setLate(false);
    setThanks(THANKS[kind]);
    router.refresh();
  });

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      {current && <div><span className={`chip ${current.tone}`}>You said: {current.text}</span></div>}
      <div className="row wrap" style={{ gap: 6 }}>
        {!started && <button type="button" className="btn small" disabled={pending} onClick={() => send("on_my_way")}>On my way</button>}
        <button type="button" className="btn ghost small" disabled={pending} aria-expanded={late} onClick={() => setLate(!late)}>Running late</button>
        <button type="button" className="btn ghost small" disabled={pending} onClick={() => {
          if (confirm("Tell your manager you can't make this shift? Please phone them as well.")) send("cant_make_it");
        }}>Can&apos;t make it</button>
      </div>
      {late && (
        <div className="row wrap" role="group" aria-label="How late?" style={{ gap: 6 }}>
          <span className="muted">About</span>
          {([15, 30, 45] as const).map((m) => (
            <button key={m} type="button" className="btn accent small" disabled={pending} onClick={() => send("late", m)}>{m} min</button>
          ))}
        </div>
      )}
      {thanks && <div className="muted" role="status">{thanks}</div>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
