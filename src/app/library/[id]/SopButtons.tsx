"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ackSop, eraseSopPhoto, reinstateSop, retireSop, startSopDraft } from "@/app/actions";

/** "I've read and understood it". */
export function AckButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="btn accent" disabled={pending} onClick={() => start(async () => {
        setErr("");
        const r = await ackSop(versionId);
        if (!r.ok) setErr(r.error); else router.refresh();
      })}>{pending ? "Saving…" : "I've read and understood it"}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

/** Managers: start a new version (or carry on with the open one). */
export function EditButton({ docId, hasDraft }: { docId: string; hasDraft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn ghost small" disabled={pending} onClick={() => start(async () => {
        setErr("");
        const r = await startSopDraft(docId);
        if (!r.ok) setErr(r.error); else router.push(`/library/${docId}/draft`);
      })}>{hasDraft ? "Open the draft" : "Edit (new version)"}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}

/** Owners and operations managers: retire an SOP (with a reason), or bring a retired one back. */
export function RetireButton({ docId, retired, title, hasDraft }: { docId: string; retired: boolean; title: string; hasDraft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setErr("");
    const r = await fn();
    if (!r.ok) setErr(r.error ?? "Something went wrong"); else { setAsking(false); router.refresh(); }
  });
  if (retired) return (
    <>
      <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => reinstateSop(docId))}>Bring it back</button>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
  return (
    <>
      <button type="button" className="btn ghost small" onClick={() => { setErr(""); setAsking(true); }}>Retire</button>
      {asking && (
        <div className="modal-back">
          <form className="modal" role="dialog" aria-label={`Retire ${title}`} onSubmit={(e) => { e.preventDefault(); run(() => retireSop(docId, note)); }}>
            <h2 className="h-sec">Retire this SOP?</h2>
            <p style={{ margin: 0 }}>Staff won&apos;t see it any more. It&apos;s kept with its history, and you can bring it back.
              {hasDraft ? " The new version being written is thrown away." : ""}</p>
            <label className="stack" style={{ gap: 6 }}><span className="muted">Why (required)</span>
              <textarea id="retire-note" autoFocus required maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced by SOP-BOH-004" /></label>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="row"><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button><button className="btn bad grow" type="submit" disabled={pending}>Retire</button></div>
          </form>
        </div>
      )}
    </>
  );
}

/**
 * The owner: erase a step's photo for good, with a reason (privacy: it shows someone, say). It shows as removed in
 * every version that uses it.
 */
export function ErasePhoto({ docId, mediaId, step }: { docId: string; mediaId: string; step: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn ghost small" onClick={() => { setErr(""); setAsking(true); }}>Erase photo</button>
      {asking && (
        <div className="modal-back">
          <form className="modal" role="dialog" aria-label={`Erase the photo in step ${step}`} onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setErr("");
              const r = await eraseSopPhoto(docId, mediaId, why);
              if (!r.ok) setErr(r.error); else { setAsking(false); router.refresh(); }
            });
          }}>
            <h2 className="h-sec">Erase this photo for good?</h2>
            <p style={{ margin: 0 }}>Use this for privacy, say if it shows someone. It shows as &ldquo;Photo removed&rdquo; in every version of this SOP that has it. This can&apos;t be undone.</p>
            <label className="stack" style={{ gap: 6 }}><span className="muted">Why (required)</span>
              <input id="erase-why" className="txt" style={{ width: "100%", maxWidth: "none" }} autoFocus required maxLength={200} value={why}
                onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Shows a member of staff's face" /></label>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="row"><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn bad grow" type="submit" disabled={pending || !why.trim()}>Erase for good</button></div>
          </form>
        </div>
      )}
    </>
  );
}
