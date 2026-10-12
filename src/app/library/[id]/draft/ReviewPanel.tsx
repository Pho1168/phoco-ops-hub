"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveDraft, publishVersion } from "@/app/actions";

const CHANGED = "It has changed since you opened it. This is the latest: check it again before you approve it";

/**
 * An approver: approve and publish (minor or major change, and when to review it next), or send it back with a note.
 * Both name the revision on screen (`rev`); if it has changed meanwhile, the page shows the latest instead.
 */
export function ReviewPanel({ docId, versionId, rev, hasPublished, reviewBy: suggested, tomorrow, asks = "Everyone it's for will be asked to read it.",
  changeNote = "Either way, everyone it's for reads it again. A major change is marked as one, so managers go through it with the team." }: {
  docId: string; versionId: string; rev: number; hasPublished: boolean; reviewBy: string; tomorrow: string;
  /** What publishing asks of staff, for the confirmation. */
  asks?: string;
  /** What minor and major mean for staff. */
  changeNote?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [change, setChange] = useState<"" | "minor" | "major">("");
  const [reviewBy, setReviewBy] = useState(suggested);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const publish = () => {
    if (hasPublished && !change) { setErr("Say whether it's a minor update or a major change"); return; }
    if (!confirm(`Approve and publish?${asks ? ` ${asks}` : ""}`)) return;
    start(async () => {
      setErr("");
      const r = await publishVersion(versionId, { rev, change: change || undefined, reviewBy });
      if (r.ok) router.push(`/library/${docId}`);
      else if (r.stale) { setErr(CHANGED); router.refresh(); }
      else setErr(r.error);
    });
  };
  const sendBack = () => start(async () => {
    setErr("");
    const r = await moveDraft(versionId, "send_back", rev, note);
    if (r.ok) router.refresh();
    else if (r.stale) { setErr(CHANGED); router.refresh(); }
    else setErr(r.error);
  });

  return (
    <div className="stack">
      <section className="card stack" aria-label="Approve">
        <h2 className="h-sec">Approve and publish</h2>
        {hasPublished && (
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
            <legend className="strong" style={{ marginBottom: 6 }}>What kind of change is it?</legend>
            <div className="seg" role="group" aria-label="Kind of change">
              <button type="button" aria-pressed={change === "minor"} onClick={() => setChange("minor")}>Minor update</button>
              <button type="button" aria-pressed={change === "major"} onClick={() => setChange("major")}>Major change</button>
            </div>
            <span className="muted">{changeNote}</span>
          </fieldset>
        )}
        <label className="stack" style={{ gap: 6 }}><span className="strong">Review it by</span>
          <input id="review-by" className="txt" type="date" min={tomorrow} value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} /></label>
        <button type="button" className="btn accent" disabled={pending} onClick={publish}>Approve and publish</button>
      </section>
      <section className="card stack" aria-label="Send back">
        <h2 className="h-sec">Send back</h2>
        <label className="stack" style={{ gap: 6 }}><span className="muted">What needs changing (the writer sees this)</span>
          <textarea id="send-back-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button type="button" className="btn ghost" disabled={pending || !note.trim()} onClick={sendBack}>Send back</button>
      </section>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

/** Whoever sent it (or an approver) takes it back to change it. */
export function TakeBack({ versionId, rev }: { versionId: string; rev: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn ghost" disabled={pending} onClick={() => start(async () => {
        setErr("");
        const r = await moveDraft(versionId, "withdraw", rev);
        if (r.ok || r.stale) router.refresh(); // changed meanwhile: show where it is now
        if (!r.ok && !r.stale) setErr(r.error);
      })}>Take it back to change it</button>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}
