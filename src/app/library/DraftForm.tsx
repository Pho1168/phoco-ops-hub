"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createDraft, moveDraft, saveDraft } from "@/app/actions";
import type { LibraryBody, LibraryKind } from "@/lib/domain/library";

/**
 * Unsaved changes are also kept on this device (this browser tab only, for this person), so they can be put back if
 * the page is left without saving: the back button, signing out, or the session ending.
 */
interface Backup<S> { rev: number; at: number; state: S }
const backupKey = (kind: LibraryKind, versionId: string | undefined, personId: string) => `library-draft:${versionId ?? `new-${kind}`}:${personId}`;
function readBackup<S>(key: string): Backup<S> | undefined {
  try { const raw = sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as Backup<S>) : undefined; } catch { return undefined; }
}
function writeBackup<S>(key: string, b: Backup<S>) {
  // Uploads in progress aren't kept: they'd never finish.
  try { sessionStorage.setItem(key, JSON.stringify(b, (k, v) => (k === "uploading" ? undefined : v))); } catch { /* storage full or blocked: leaving still asks first */ }
}
function dropBackup(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* nothing kept */ }
}
const timeOf = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export interface DraftFormProps<S> {
  kind: LibraryKind;
  /** "new" creates the document and its first draft; "draft" saves the open draft (revision `rev`, as loaded). */
  mode: "new" | "draft"; docId?: string; versionId?: string; rev?: number; published?: boolean; canDiscard?: boolean;
  /** Who is writing: their unsaved changes are kept on this device under their name only. */
  personId: string;
  /** What the fields start from (as loaded). */
  initial: S;
  /** What's sent to the server. */
  toInput: (s: S) => unknown;
  /** The fields after a save, from what the server kept (cleaned). */
  fromSaved: (saved: { title: string; body: LibraryBody }) => S;
  /** What would be saved, to tell whether a kept copy differs from what's loaded. */
  fingerprint: (s: S) => string;
  /** Photos still uploading: saving waits. */
  busy: (s: S) => boolean;
  /** The fields: the state, a way to change it (marks the form changed), and somewhere to show an error. */
  children: (s: S, set: (fn: (s: S) => S) => void, setErr: (e: string) => void) => ReactNode;
}

/**
 * The editor every library kind shares: saving, sending for approval and discarding, each naming the revision it was
 * loaded at, so if someone else saves meanwhile nothing is overwritten and the writer is offered the latest. Unsaved
 * changes are kept on the device and offered back; leaving with them (a link, reload, signing out) asks first.
 */
export function DraftForm<S>({ kind, mode, docId, versionId, rev: loadedRev, published, canDiscard, personId, initial, toInput, fromSaved, fingerprint, busy, children }: DraftFormProps<S>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<S>(initial);
  const [rev, setRev] = useState(loadedRev ?? 1);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [restore, setRestore] = useState<Backup<S>>();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const edits = useRef(0); // counts changes, so a save doesn't undo typing done while it was saving
  const latest = useRef(state);
  latest.current = state;
  const key = backupKey(kind, mode === "new" ? undefined : versionId, personId);

  // Changes left unsaved last time (in this tab): offer to put them back. Checked once, against what was loaded.
  const loaded = useRef({ initial, fingerprint });
  useEffect(() => {
    const kept = readBackup<S>(key);
    if (!kept) return;
    const { initial: first, fingerprint: print } = loaded.current;
    // Kept before the editor had a field (say, a dish's labels): that field starts as loaded.
    const b = { ...kept, state: { ...(first as object), ...(kept.state as object) } as S };
    if (print(b.state) === print(first)) dropBackup(key); else setRestore(b);
  }, [key]);

  // Keep unsaved changes on the device as they're made.
  useEffect(() => {
    if (dirty) writeBackup(key, { rev, at: Date.now(), state });
  }, [dirty, key, rev, state]);

  // Leaving with unsaved changes asks first: closing or reloading the page, following a link, or signing out.
  useEffect(() => {
    if (!dirty) return;
    let leaving = false;
    const ask = (e: Event) => {
      if (confirm("Leave without saving your changes?")) { leaving = true; return; }
      e.preventDefault(); e.stopPropagation();
    };
    const stay = (e: BeforeUnloadEvent) => { if (!leaving) e.preventDefault(); };
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.getAttribute("target") === "_blank") return;
      ask(e);
    };
    const onSubmit = (e: SubmitEvent) => { if (e.target !== form.current) ask(e); }; // "Switch user" is a form
    window.addEventListener("beforeunload", stay);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => { window.removeEventListener("beforeunload", stay); document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); };
  }, [dirty]);

  const set = (fn: (s: S) => S) => { setState(fn); edits.current++; setDirty(true); setMsg(""); };
  const putBack = () => {
    if (!restore) return;
    const kept = restore.state;
    setRestore(undefined);
    set(() => kept);
  };
  const throwAway = () => { dropBackup(key); setRestore(undefined); };

  const save = (then?: "submit") => start(async () => {
    setErr(""); setMsg("");
    const before = edits.current;
    if (mode === "new") {
      const r = await createDraft(kind, toInput(state));
      if (!r.ok || !r.id) { setErr(r.ok ? "Something went wrong" : r.error); return; }
      // Anything typed while it was being created goes with it, to put back on the draft.
      if (edits.current !== before && r.versionId) writeBackup(backupKey(kind, r.versionId, personId), { rev: 1, at: Date.now(), state: latest.current });
      dropBackup(key);
      setDirty(false);
      router.replace(`/library/${r.id}/draft`);
      return;
    }
    let at = rev;
    const saving = dirty;
    if (saving) {
      const r = await saveDraft(versionId!, rev, toInput(state));
      if (!r.ok) { if (r.stale) setStale(true); else setErr(r.error); return; }
      at = r.rev!;
      setRev(at);
      if (edits.current !== before) { // more was typed while it saved: keep it, and don't send yet
        setMsg(then === "submit" ? "Saved, but you changed it while it was saving. Send it again when you're ready" : "Saved");
        return;
      }
      // Carry on from what was saved (empty lines and steps are gone).
      if (r.saved) setState(fromSaved(r.saved));
      setDirty(false);
      dropBackup(key);
    }
    if (then === "submit") {
      const s = await moveDraft(versionId!, "submit", at);
      if (!s.ok) { if (s.stale) setStale(true); else setErr(saving ? `Saved, but not sent yet: ${s.error}` : s.error); return; }
      dropBackup(key);
      router.refresh();
      return;
    }
    setMsg(saving ? "Saved" : "No changes to save");
  });

  const discard = () => {
    if (!confirm("Discard this draft? It can't be brought back.")) return;
    start(async () => {
      const r = await moveDraft(versionId!, "discard", rev);
      if (!r.ok) { if (r.stale) setStale(true); else setErr(r.error); return; }
      dropBackup(key);
      setDirty(false);
      router.push(published && docId ? `/library/${docId}` : kind === "sop" ? "/library" : "/library/recipes");
    });
  };

  const loadLatest = () => {
    if (dirty && !confirm("Load the latest version? Your changes here will be lost.")) return;
    dropBackup(key);
    setDirty(false);
    router.refresh(); // the page gives the editor the latest revision
  };

  const uploading = busy(state);
  return (
    <form ref={form} className="stack" style={{ gap: 18, paddingBottom: 90 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {restore && (
        <div className="alert" role="status"><div className="grow stack" style={{ gap: 6 }}>
          <div className="strong">You have changes from {timeOf(restore.at)} that weren&apos;t saved</div>
          {mode === "draft" && restore.rev !== rev && <div style={{ fontSize: 14 }}>Someone has saved this draft since then. If you put yours back and save, they replace theirs.</div>}
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={putBack}>Put them back</button>
            <button type="button" className="btn ghost small" onClick={throwAway}>Throw them away</button>
          </div>
        </div></div>
      )}
      {children(state, set, setErr)}
      {stale && (
        <div className="alert bad" role="alert"><div className="grow stack" style={{ gap: 6 }}>
          <div className="strong">Someone else has changed this draft since you opened it</div>
          <div style={{ fontSize: 14 }}>Yours wasn&apos;t saved, so nothing of theirs was lost. Copy anything you want to keep, then load the latest and add it back.</div>
          <div><button type="button" className="btn ghost small" onClick={loadLatest}>Load the latest</button></div>
        </div></div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong">{msg}</div></div>}
      <div className="sticky-foot">
        <div className="inner">
          {mode === "draft" && canDiscard && <button type="button" className="btn ghost" disabled={pending} onClick={discard}>Discard</button>}
          <button type="submit" className="btn grow" disabled={pending || uploading || stale}>{mode === "new" ? "Create draft" : pending ? "Saving…" : "Save draft"}</button>
          {mode === "draft" && <button type="button" className="btn accent grow" disabled={pending || uploading || stale} onClick={() => save("submit")}>Send for approval</button>}
        </div>
      </div>
    </form>
  );
}
