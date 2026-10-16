"use client";

import Image from "next/image";
import { Icon } from "@/components/Icon";
import { SOP_LIMITS, type Photo, type SopStep } from "@/lib/domain/library";

/** Keys for list rows: unique across page loads too, so rows put back from a kept copy never clash with new ones. */
let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${++seq}`;

/** Makes a photo smaller on the device before it's sent: at most 1600 px on the long side, as JPEG. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't prepare photos");
  g.fillStyle = "#fff"; // a see-through PNG would otherwise turn black as a JPEG
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("This browser can't prepare photos");
  return { blob, w, h };
}

/** Uploads a photo (made smaller first); the server reads its real size. */
export async function upload(file: File, purpose?: "stock"): Promise<Photo> {
  let small: Awaited<ReturnType<typeof shrink>>;
  try { small = await shrink(file); } catch { throw new Error("Couldn't read that photo. Take it again, or choose a JPEG or PNG"); }
  const r = await fetch(purpose ? `/api/media?for=${purpose}` : "/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: small.blob });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; w?: number; h?: number; error?: string };
  if (!r.ok || !j.ok || !j.id || !j.w || !j.h) throw new Error(j.error ?? "The photo didn't upload. Try again");
  return { id: j.id, w: j.w, h: j.h };
}

export interface EditStep { key: string; text: string; warning: string; showWarning: boolean; photo?: Photo; uploading?: boolean }
export const blankStep = (): EditStep => ({ key: newKey(), text: "", warning: "", showWarning: false });
export const editSteps = (steps: SopStep[]): EditStep[] => steps.length
  ? steps.map((s) => ({ key: newKey(), text: s.text, warning: s.warning ?? "", showWarning: !!s.warning, photo: s.photo }))
  : [blankStep()];
export const stepsInput = (steps: EditStep[]) => steps.map((s) => ({ text: s.text, warning: s.showWarning ? s.warning : undefined, photo: s.photo }));
/** For telling whether two versions of the steps differ in what would be saved. */
export const stepsPrint = (steps: EditStep[]) => steps.map((s) => [s.text.trim(), s.showWarning ? s.warning.trim() : "", s.photo?.id ?? ""]).filter((s) => s.some(Boolean));

/** Moves item i up or down a list. */
export function moved<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A photo in an editor: removed by the owner, or the picture. */
export function Thumb({ photo, label, erased, small }: { photo: Photo; label: string; erased: boolean; small?: boolean }) {
  return erased
    ? <div className={`photo-removed ${small ? "small" : ""}`} role="img" aria-label={`${label}: removed`}>{small ? "Removed" : "Photo removed"}</div>
    : <Image className={`thumb ${small ? "small" : ""}`} src={`/api/media/${photo.id}`} width={photo.w} height={photo.h} alt={label} unoptimized />;
}

/** "Add photo" / "Change photo": picks or takes a photo and uploads it. */
export function PhotoButton({ label, has, uploading, onFile }: { label: string; has: boolean; uploading?: boolean; onFile: (f: File | undefined) => void }) {
  return (
    <label className="btn ghost small" style={{ gap: 8, cursor: uploading ? "progress" : "pointer" }}>
      <Icon name="camera" />{uploading ? "Uploading…" : has ? "Change photo" : "Add photo"}
      <input type="file" accept="image/*" hidden disabled={uploading} aria-label={label}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
    </label>
  );
}

/**
 * Numbered steps, each with an optional warning (shown in red) and photo. `set` changes the list (and marks the form
 * changed); upload errors go to `setErr`.
 */
export function StepsField({ steps, set, setErr, erased, title = "Steps", placeholder = "What to do, in plain words" }: {
  steps: EditStep[]; set: (fn: (s: EditStep[]) => EditStep[]) => void; setErr: (e: string) => void; erased: string[]; title?: string; placeholder?: string;
}) {
  const patch = (key: string, p: Partial<EditStep>) => set((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const remove = (s: EditStep, n: number) => {
    if ((s.text || s.warning || s.photo) && !confirm(`Remove step ${n}?`)) return;
    set((cur) => (cur.length > 1 ? cur.filter((x) => x.key !== s.key) : [blankStep()]));
  };
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
  return (
    <section className="stack" aria-label={title}>
      <h2 className="h-sec">{title}</h2>
      {steps.map((s, i) => (
        <div key={s.key} className="editor-step">
          <div className="row" style={{ gap: 8 }}>
            <span className="sop-num" aria-hidden="true">{i + 1}</span>
            <span className="grow strong">Step {i + 1}</span>
            <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => set((cur) => moved(cur, i, -1))}>↑</button>
            <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => set((cur) => moved(cur, i, 1))}>↓</button>
            <button type="button" className="btn ghost small" aria-label={`Remove step ${i + 1}`} onClick={() => remove(s, i + 1)}>✕</button>
          </div>
          <textarea aria-label={`Step ${i + 1}`} maxLength={SOP_LIMITS.step} placeholder={placeholder} value={s.text} onChange={(e) => patch(s.key, { text: e.target.value })} />
          {s.showWarning && (
            <label className="stack" style={{ gap: 4 }}><span className="muted">Warning (shown in red)</span>
              <textarea aria-label={`Warning for step ${i + 1}`} className="warn-box" maxLength={SOP_LIMITS.warning} placeholder="e.g. Never use a probe that reads more than 1°C out"
                value={s.warning} onChange={(e) => patch(s.key, { warning: e.target.value })} /></label>
          )}
          {s.photo && (
            <div className="row wrap" style={{ gap: 10 }}>
              <Thumb photo={s.photo} label={`Photo for step ${i + 1}`} erased={erased.includes(s.photo.id)} />
              <button type="button" className="btn ghost small" onClick={() => patch(s.key, { photo: undefined })}>Remove photo</button>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            {s.showWarning
              ? <button type="button" className="btn ghost small" onClick={() => patch(s.key, { showWarning: false, warning: "" })}>Remove warning</button>
              : <button type="button" className="btn ghost small" onClick={() => patch(s.key, { showWarning: true })}>Add a warning</button>}
            <PhotoButton label={`Photo for step ${i + 1}`} has={!!s.photo} uploading={s.uploading} onFile={(f) => void addPhoto(s.key, f)} />
          </div>
        </div>
      ))}
      {steps.length < SOP_LIMITS.steps && <button type="button" className="btn ghost" onClick={() => set((cur) => [...cur, blankStep()])}>Add a step</button>}
    </section>
  );
}

/** One photo for the whole thing (a recipe's finished product or dish). */
export function PhotoField({ photo, uploading, set, setErr, erased, label }: {
  photo?: Photo; uploading?: boolean; set: (p: { photo?: Photo; uploading?: boolean }) => void; setErr: (e: string) => void; erased: string[]; label: string;
}) {
  const add = async (file: File | undefined) => {
    if (!file) return;
    setErr("");
    set({ photo, uploading: true });
    try { set({ photo: await upload(file), uploading: false }); } catch (e) {
      set({ photo, uploading: false });
      setErr(e instanceof Error ? e.message : "The photo didn't upload. Try again");
    }
  };
  return (
    <div className="row wrap" style={{ gap: 10 }}>
      {photo && <Thumb photo={photo} label={label} erased={erased.includes(photo.id)} />}
      <PhotoButton label={label} has={!!photo} uploading={uploading} onFile={(f) => void add(f)} />
      {photo && <button type="button" className="btn ghost small" onClick={() => set({ photo: undefined, uploading: false })}>Remove photo</button>}
    </div>
  );
}
