"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { SopStep } from "@/lib/domain/library";

/**
 * One step per screen in big text, for following an SOP at the station. Keeps the screen on while open (where the
 * browser allows: it lets go when the tab is hidden, so it's asked for again on return). Arrow keys and Escape work
 * on a keyboard; focus stays inside while it's open and goes back to the button when it closes.
 */
export function StepMode({ title, steps }: { title: string; steps: SopStep[] }) {
  const [i, setI] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const open = i !== null;

  // The screen stays on while it's open.
  useEffect(() => {
    if (!open || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let done = false;
    const ask = () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      navigator.wakeLock.request("screen").then((l) => { if (done) l.release().catch(() => undefined); else lock = l; }).catch(() => undefined);
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => { done = true; document.removeEventListener("visibilitychange", ask); lock?.release().catch(() => undefined); };
  }, [open]);

  // Keys, no scrolling behind, and focus in and back out.
  useEffect(() => {
    if (!open) return;
    const back = opener.current;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setI(null);
      else if (e.key === "ArrowRight") setI((n) => (n === null ? n : Math.min(n + 1, steps.length - 1)));
      else if (e.key === "ArrowLeft") setI((n) => (n === null ? n : Math.max(n - 1, 0)));
      else if (e.key === "Tab" && box.current) {
        const all = Array.from(box.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!all.length) return;
        const first = all[0], last = all[all.length - 1], at = document.activeElement;
        if (e.shiftKey && (at === first || at === box.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (at === last || !box.current.contains(at))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; back?.focus(); };
  }, [open, steps.length]);

  if (!steps.length) return null;
  const s = open ? steps[i] : undefined;
  const last = open && i === steps.length - 1;
  return (
    <>
      <button ref={opener} type="button" className="btn accent" onClick={() => setI(0)}>Step by step</button>
      {open && s && (
        <div ref={box} tabIndex={-1} className="step-mode" role="dialog" aria-modal="true" aria-label={`${title}: step by step`}>
          <div className="top" style={{ position: "static" }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{title}</div>
              <div className="logo" style={{ fontSize: 26 }}>Step {i + 1} of {steps.length}</div>
            </div>
            <button type="button" className="pill-btn" onClick={() => setI(null)}>Close</button>
          </div>
          <div className="bar" style={{ borderRadius: 0, background: "var(--surface-2)" }} aria-hidden="true"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
          <div className="step-body" aria-live="polite">
            <span className="sr-only">Step {i + 1} of {steps.length}. </span>
            <div className="step-text">{s.text}</div>
            {s.warning && <div className="sop-warn" role="note" style={{ fontSize: 20 }}><Icon name="alert" /><span>{s.warning}</span></div>}
            {s.photo && <Image className="sop-photo" src={`/api/media/${s.photo.id}`} width={s.photo.w} height={s.photo.h} alt={`Step ${i + 1}`} unoptimized />}
          </div>
          <div className="step-foot">
            <button type="button" className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
            {last ? <button type="button" className="btn accent" onClick={() => setI(null)}>Done</button>
              : <button type="button" className="btn accent" onClick={() => setI(i + 1)}>Next</button>}
          </div>
        </div>
      )}
    </>
  );
}
