"use client";

import { SECTION_TEXT, SOP_LIMITS, type LibraryBody, type SopBody } from "@/lib/domain/library";
import { DraftForm } from "./DraftForm";
import { editSteps, stepsInput, stepsPrint, StepsField, type EditStep } from "./fields";

interface SopState { title: string; sections: string[]; purpose: string; steps: EditStep[] }
const SECTIONS = ["FOH", "BOH", "PROD"] as const;

const fromBody = (title: string, body: SopBody): SopState => ({ title, sections: body.sections, purpose: body.purpose, steps: editSteps(body.steps) });
const toInput = (s: SopState) => ({ title: s.title, sections: s.sections, purpose: s.purpose, steps: stepsInput(s.steps) });
const fromSaved = (saved: { title: string; body: LibraryBody }) => fromBody(saved.title, saved.body as SopBody);
const fingerprint = (s: SopState) => JSON.stringify([s.title.trim(), [...s.sections].sort(), s.purpose.trim(), stepsPrint(s.steps)]);
const busy = (s: SopState) => s.steps.some((x) => x.uploading);

/**
 * Writing an SOP: title, who reads it, what it's for, and the steps (each with an optional warning and photo).
 * Saving, approval and keeping unsaved changes are DraftForm's.
 */
export function SopEditor({ mode, docId, versionId, rev, published, initial, erased = [], canDiscard, personId }: {
  mode: "new" | "draft"; docId?: string; versionId?: string; rev?: number; published?: boolean; initial: { title: string; body: SopBody };
  /** Photos the owner has erased: shown as removed, and left out when it's saved. */
  erased?: string[]; canDiscard?: boolean; personId: string;
}) {
  return (
    <DraftForm kind="sop" mode={mode} docId={docId} versionId={versionId} rev={rev} published={published} canDiscard={canDiscard} personId={personId}
      initial={fromBody(initial.title, initial.body)} toInput={toInput} fromSaved={fromSaved} fingerprint={fingerprint} busy={busy}>
      {(s, set, setErr) => (
        <>
          <section className="card stack" aria-label="Details">
            <label className="stack" style={{ gap: 6 }}><span className="strong">Title</span>
              <input id="sop-title" className="txt" style={{ width: "100%", maxWidth: "none" }} required maxLength={SOP_LIMITS.title} autoComplete="off" placeholder="e.g. Probe calibration"
                value={s.title} onChange={(e) => { const title = e.target.value; set((x) => ({ ...x, title })); }} /></label>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
              <legend className="strong" style={{ marginBottom: 6 }}>Who must read it</legend>
              <div className="row wrap" style={{ gap: 16 }}>
                {SECTIONS.map((sec) => (
                  <label key={sec} className="row" style={{ gap: 8 }}>
                    <input type="checkbox" className="check" checked={s.sections.includes(sec)}
                      onChange={(e) => { const on = e.target.checked; set((x) => ({ ...x, sections: on ? [...x.sections, sec] : x.sections.filter((y) => y !== sec) })); }} />
                    <span>{SECTION_TEXT[sec]}</span>
                  </label>
                ))}
              </div>
              <span className="muted">{s.sections.length ? "Staff in these sections, and the managers of those sites." : "None ticked: everyone at every site."}
                {mode === "new" ? " It also sets the SOP's code (SOP-BOH-…), which never changes." : ""}</span>
            </fieldset>
            <label className="stack" style={{ gap: 6 }}><span className="strong">What it&apos;s for</span>
              <span className="muted">Why it matters and when it&apos;s used, in a sentence or two.</span>
              <textarea id="sop-purpose" maxLength={SOP_LIMITS.purpose} value={s.purpose} onChange={(e) => { const purpose = e.target.value; set((x) => ({ ...x, purpose })); }} /></label>
          </section>
          <StepsField steps={s.steps} set={(fn) => set((x) => ({ ...x, steps: fn(x.steps) }))} setErr={setErr} erased={erased} />
        </>
      )}
    </DraftForm>
  );
}
