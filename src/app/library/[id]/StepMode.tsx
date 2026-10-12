"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { SopStep } from "@/lib/domain/library";

/**
 * One step per screen in big text, for following an SOP at the station. Keeps the screen on while open
 * (where the browser allows), and arrow keys work on a keyboard.
 */
export function StepMode({ title, steps }: { title: string; steps: SopStep[] }) {
  const [i, setI] = useState<number | null>(null);
  const close = useCallback(() => setI(null), []);
  const open = i !== null;

  useEffect(() => {
    if (!open) return;
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setI(null);
      if (e.key === "ArrowRight") setI((n) => (n === null ? n : Math.min(n + 1, steps.length - 1)));
      if (e.key === "ArrowLeft") setI((n) => (n === null ? n : Math.max(n - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { lock?.release().catch(() => undefined); window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, steps.length]);

  if (!steps.length) return null;
  if (i === null) return <button type="button" className="btn accent" onClick={() => setI(0)}>Step by step</button>;
  const s = steps[i];
  const last = i === steps.length - 1;
  return (
    <div className="step-mode" role="dialog" aria-modal="true" aria-label={`${title}: step ${i + 1} of ${steps.length}`}>
      <div className="top" style={{ position: "static" }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{title}</div>
          <div className="logo" style={{ fontSize: 26 }}>Step {i + 1} of {steps.length}</div>
        </div>
        <button type="button" className="pill-btn" onClick={close}>Close</button>
      </div>
      <div className="bar" style={{ borderRadius: 0, background: "var(--surface-2)" }} aria-hidden="true"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      <div className="step-body">
        <div className="step-text">{s.text}</div>
        {s.warning && <div className="sop-warn" role="note" style={{ fontSize: 20 }}><Icon name="alert" /><span>{s.warning}</span></div>}
        {s.photo && <Image className="sop-photo" src={`/api/media/${s.photo.id}`} width={s.photo.w} height={s.photo.h} alt={`Step ${i + 1}`} unoptimized />}
      </div>
      <div className="step-foot">
        <button type="button" className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
        {last ? <button type="button" className="btn accent" onClick={close}>Done</button>
          : <button type="button" className="btn accent" onClick={() => setI(i + 1)}>Next</button>}
      </div>
    </div>
  );
}
