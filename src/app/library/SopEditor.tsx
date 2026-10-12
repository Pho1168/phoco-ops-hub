"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSop, moveSop, saveSopDraft } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { SECTION_TEXT, SOP_LIMITS, type Photo, type SopBody } from "@/lib/domain/library";

interface EditStep { key: string; text: string; warning: string; showWarning: boolean; photo?: Photo; uploading?: boolean }
let seq = 0;
const newKey = () => `s${++seq}`;
const blank = (): EditStep => ({ key: newKey(), text: "", warning: "", showWarning: false });
const SECTIONS = ["FOH", "BOH", "PROD"] as const;

/** Makes a photo smaller on the device before it's sent: at most 1600 px on the long side, as JPEG. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't prepare photos");
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("This browser can't prepare photos");
  return { blob, w, h };
}

async function upload(file: File): Promise<Photo> {
  let small: Awaited<ReturnType<typeof shrink>>;
  try { small = await shrink(file); } catch { throw new Error("Couldn't read that photo. Take it again, or choose a JPEG or PNG"); }
  const r = await fetch("/api/media", { method: "POST", headers: { "content-type": "image/jpeg", "x-width": String(small.w), "x-height": String(small.h) }, body: small.blob });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; w?: number; h?: number; error?: string };
  if (!r.ok || !j.ok || !j.id) throw new Error(j.error ?? "The photo didn't upload. Try again");
  return { id: j.id, w: j.w ?? small.w, h: j.h ?? small.h };
}

/**
 * Writing an SOP: title, who reads it, what it's for, and the steps (each with an optional warning and photo).
 * "new" creates the document and its first draft; "draft" saves the open draft and can send it for approval.
 */
export function SopEditor({ mode, docId, versionId, initial, canDiscard }: {
  mode: "new" | "draft"; docId?: string; versionId?: string; initial: { title: string; body: SopBody }; canDiscard?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [sections, setSections] = useState<string[]>(initial.body.sections);
  const [purpose, setPurpose] = useState(initial.body.purpose);
  const [steps, setSteps] = useState<EditStep[]>(() => initial.body.steps.length
    ? initial.body.steps.map((s) => ({ key: newKey(), text: s.text, warning: s.warning ?? "", showWarning: !!s.warning, photo: s.photo }))
    : [blank()]);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [dirty]);

  const touched = () => { setDirty(true); setMsg(""); };
  const patch = (key: string, p: Partial<EditStep>) => { setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s))); touched(); };
  const move = (i: number, d: -1 | 1) => {
    setSteps((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touched();
  };
  const remove = (s: EditStep, n: number) => {
    if ((s.text || s.warning || s.photo) && !confirm(`Remove step ${n}?`)) return;
    setSteps((cur) => (cur.length > 1 ? cur.filter((x) => x.key !== s.key) : [blank()]));
    touched();
  };
  const uploading = steps.some((s) => s.uploading);
  const payload = () => ({ title, sections, purpose, steps: steps.map((s) => ({ text: s.text, warning: s.showWarning ? s.warning : undefined, photo: s.photo })) });

  const addPhoto = async (key: string, file: File | undefined) => {
    if (!file) return;
    setErr("");
    patch(key, { uploading: true });
    try {
      patch(key, { photo: await upload(file), uploading: false });
    } catch (e) {
      patch(key, { uploading: false });
      setErr(e instanceof Error ? e.message : "The photo didn't upload. Try again");
    }
  };

  const save = (then?: "submit") => start(async () => {
    setErr(""); setMsg("");
    if (mode === "new") {
      const r = await createSop(payload());
      if (!r.ok || !r.id) { setErr(r.ok ? "Something went wrong" : r.error); return; }
      setDirty(false);
      router.replace(`/library/${r.id}/draft`);
      return;
    }
    const r = await saveSopDraft(versionId!, payload());
    if (!r.ok) { setErr(r.error); return; }
    setDirty(false);
    if (then === "submit") {
      const s = await moveSop(versionId!, "submit");
      if (!s.ok) setErr(`Saved, but not sent: ${s.error}`);
      router.refresh();
      return;
    }
    setMsg("Saved");
    router.refresh();
  });

  const discard = () => {
    if (!confirm("Discard this draft? It's kept in the history, marked discarded.")) return;
    start(async () => {
      const r = await moveSop(versionId!, "discard");
      if (!r.ok) { setErr(r.error); return; }
      setDirty(false);
      router.push(docId ? `/library/${docId}` : "/library");
    });
  };

  return (
    <form className="stack" style={{ gap: 18, paddingBottom: 90 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <section className="card stack" aria-label="Details">
        <label className="stack" style={{ gap: 6 }}><span className="strong">Title</span>
          <input id="sop-title" className="txt" style={{ width: "100%", maxWidth: "none" }} required maxLength={SOP_LIMITS.title} autoComplete="off" placeholder="e.g. Probe calibration"
            value={title} onChange={(e) => { setTitle(e.target.value); touched(); }} /></label>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend className="strong" style={{ marginBottom: 6 }}>Who must read it</legend>
          <div className="row wrap" style={{ gap: 16 }}>
            {SECTIONS.map((s) => (
              <label key={s} className="row" style={{ gap: 8 }}>
                <input type="checkbox" className="check" checked={sections.includes(s)}
                  onChange={(e) => { setSections(e.target.checked ? [...sections, s] : sections.filter((x) => x !== s)); touched(); }} />
                <span>{SECTION_TEXT[s]}</span>
              </label>
            ))}
          </div>
          <span className="muted">{sections.length ? "Staff in these sections, and the managers of those sites." : "None ticked: everyone at every site."}
            {mode === "new" ? " It also sets the SOP's code (SOP-BOH-…), which never changes." : ""}</span>
        </fieldset>
        <label className="stack" style={{ gap: 6 }}><span className="strong">What it&apos;s for</span>
          <span className="muted">Why it matters and when it&apos;s used, in a sentence or two.</span>
          <textarea id="sop-purpose" maxLength={SOP_LIMITS.purpose} value={purpose} onChange={(e) => { setPurpose(e.target.value); touched(); }} /></label>
      </section>

      <section className="stack" aria-label="Steps">
        <h2 className="h-sec">Steps</h2>
        {steps.map((s, i) => (
          <div key={s.key} className="editor-step">
            <div className="row" style={{ gap: 8 }}>
              <span className="sop-num" aria-hidden="true">{i + 1}</span>
              <span className="grow strong">Step {i + 1}</span>
              <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn ghost small" aria-label={`Remove step ${i + 1}`} onClick={() => remove(s, i + 1)}>✕</button>
            </div>
            <textarea aria-label={`Step ${i + 1}`} maxLength={SOP_LIMITS.step} placeholder="What to do, in plain words" value={s.text} onChange={(e) => patch(s.key, { text: e.target.value })} />
            {s.showWarning && (
              <label className="stack" style={{ gap: 4 }}><span className="muted">Warning (shown in red)</span>
                <textarea aria-label={`Warning for step ${i + 1}`} className="warn-box" maxLength={SOP_LIMITS.warning} placeholder="e.g. Never use a probe that reads more than 1°C out"
                  value={s.warning} onChange={(e) => patch(s.key, { warning: e.target.value })} /></label>
            )}
            {s.photo && (
              <div className="row wrap" style={{ gap: 10 }}>
                <Image className="thumb" src={`/api/media/${s.photo.id}`} width={s.photo.w} height={s.photo.h} alt={`Photo for step ${i + 1}`} unoptimized />
                <button type="button" className="btn ghost small" onClick={() => patch(s.key, { photo: undefined })}>Remove photo</button>
              </div>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              {s.showWarning
                ? <button type="button" className="btn ghost small" onClick={() => patch(s.key, { showWarning: false, warning: "" })}>Remove warning</button>
                : <button type="button" className="btn ghost small" onClick={() => patch(s.key, { showWarning: true })}>Add a warning</button>}
              <label className="btn ghost small" style={{ gap: 8, cursor: s.uploading ? "progress" : "pointer" }}>
                <Icon name="camera" />{s.uploading ? "Uploading…" : s.photo ? "Change photo" : "Add photo"}
                <input type="file" accept="image/*" hidden disabled={s.uploading} aria-label={`Photo for step ${i + 1}`}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void addPhoto(s.key, f); }} />
              </label>
            </div>
          </div>
        ))}
        {steps.length < SOP_LIMITS.steps && <button type="button" className="btn ghost" onClick={() => { setSteps((cur) => [...cur, blank()]); touched(); }}>Add a step</button>}
      </section>

      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong">{msg}</div></div>}
      <div className="sticky-foot">
        <div className="inner">
          {mode === "draft" && canDiscard && <button type="button" className="btn ghost" disabled={pending} onClick={discard}>Discard</button>}
          <button type="submit" className="btn grow" disabled={pending || uploading}>{mode === "new" ? "Create draft" : pending ? "Saving…" : "Save draft"}</button>
          {mode === "draft" && <button type="button" className="btn accent grow" disabled={pending || uploading} onClick={() => save("submit")}>Send for approval</button>}
        </div>
      </div>
    </form>
  );
}
