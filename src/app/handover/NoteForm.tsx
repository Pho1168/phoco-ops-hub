"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote } from "@/app/actions";
import { NOTE_CATEGORIES, type NoteCategory } from "@/lib/domain/handover";

/** Add a note for the next shift. It shows straight away and goes on the next handover report. */
export function NoteForm() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NoteCategory>("Equipment");
  const [needsAction, setNeedsAction] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  const submit = () => start(async () => {
    setErr(""); setMsg("");
    if (!body.trim()) { setErr("Write the note first"); box.current?.focus(); return; }
    const r = await addNote({ category, body, needsAction });
    if (!r.ok) { setErr(r.error); return; }
    setBody(""); setMsg(needsAction ? "Added. It stays on the list until someone ticks it done." : "Added for info.");
    router.refresh();
  });

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2 className="h-sec">Add a note</h2>
      <textarea ref={box} id="note-body" aria-label="Note for the next shift" maxLength={1000} value={body}
        onChange={(e) => { setErr(""); setMsg(""); setBody(e.target.value); }}
        placeholder="e.g. Fridge 3 door not closing properly, engineer booked for Monday" />
      <div className="row wrap" style={{ gap: 10 }}>
        <select id="note-cat" aria-label="Type of note" value={category} onChange={(e) => setCategory(e.target.value as NoteCategory)}>
          {NOTE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="seg grow" role="group" aria-label="Does it need doing?" style={{ minWidth: 220 }}>
          <button type="button" aria-pressed={needsAction} onClick={() => setNeedsAction(true)}>Needs action</button>
          <button type="button" aria-pressed={!needsAction} onClick={() => setNeedsAction(false)}>For info</button>
        </div>
      </div>
      <div className="muted">{needsAction ? "Stays on the list until someone ticks it done." : "Shows for this shift and the next, then drops off. Nothing to tick."}</div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <button className="btn accent" type="submit" disabled={pending}>{pending ? "Adding…" : "Add note"}</button>
    </form>
  );
}
