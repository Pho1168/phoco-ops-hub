"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote } from "@/app/actions";
import type { PickGroup } from "@/lib/domain/assign";
import { NOTE_CATEGORIES, type NoteCategory } from "@/lib/domain/handover";
import { ForSelect } from "./ForSelect";

/**
 * Add a note for the next shift. It shows straight away and goes on the next handover report. A note that needs
 * doing can be for someone (`pick`: who can be picked).
 */
export function NoteForm({ pick }: { pick?: PickGroup[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NoteCategory>("Equipment");
  const [needsAction, setNeedsAction] = useState(true);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  const submit = () => start(async () => {
    setErr(""); setMsg("");
    if (!body.trim()) { setErr("Write the note first"); box.current?.focus(); return; }
    const to = needsAction ? assignee : null;
    const r = await addNote({ category, body, needsAction, assignee: to });
    if (!r.ok) { setErr(r.error); return; }
    const name = to ? pick?.flatMap((g) => g.people).find((p) => p.id === to)?.name : undefined;
    setBody(""); setAssignee(null);
    setMsg(needsAction ? `Added${name ? ` for ${name}` : ""}. It stays on the list until someone ticks it done.` : "Added for info.");
    router.refresh();
  });

  return (
    <form className="composer" aria-label="Add a note" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
      {needsAction && pick && (
        <div className="for-pick" style={{ marginTop: 0 }}>
          <span>For</span>
          <ForSelect id="note-for" value={assignee ?? ""} pick={pick} label="Who the note is for" onChange={setAssignee} />
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="muted grow" style={{ fontSize: 12 }}>{needsAction ? "Stays on the list until someone ticks it done." : "Shows for this shift and the next, then drops off. Nothing to tick."}</span>
        <button className="btn accent small" type="submit" disabled={pending}>{pending ? "Adding…" : "Add note"}</button>
      </div>
    </form>
  );
}
