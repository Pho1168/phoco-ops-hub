"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCertificate } from "@/app/actions";
import { suggestExpiry, type CertKind } from "@/lib/domain/certificates";

export interface KindOption { id: CertKind; label: string; renewYears?: number; dates?: { issued: string; expires: string }; noReference?: boolean; expected: boolean }

/** Record a certificate or check. The expiry date is suggested from the issue date; it can be changed or cleared. */
export function CertForm({ personId, personName, kinds, defaultKind, today }: { personId: string; personName: string; kinds: KindOption[]; defaultKind: CertKind; today: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<CertKind>(defaultKind);
  const [issued, setIssued] = useState("");
  const [expires, setExpires] = useState("");
  const [touched, setTouched] = useState(false);
  const [provider, setProvider] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const k = kinds.find((x) => x.id === kind) ?? kinds[0];

  const pickKind = (id: CertKind) => { setKind(id); if (!touched) setExpires(suggestExpiry(id, issued) ?? ""); };
  const pickIssued = (v: string) => { setIssued(v); if (!touched) setExpires(suggestExpiry(kind, v) ?? ""); };

  const save = () => start(async () => {
    setErr(""); setMsg("");
    const r = await addCertificate({ personId, kind, issuedOn: issued, expiresOn: expires, provider, reference: k.noReference ? "" : reference, note });
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`${k.label} saved for ${personName}.`);
    setIssued(""); setExpires(""); setTouched(false); setProvider(""); setReference(""); setNote("");
    router.refresh();
  });

  return (
    <form className="card stack" aria-label="Add a certificate" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 className="h-sec">Add a certificate or check</h2>
      <label className="stack" style={{ gap: 4 }}><span className="muted">What</span>
        <select id="cert-kind" value={kind} onChange={(e) => pickKind(e.target.value as CertKind)}>
          {kinds.map((x) => <option key={x.id} value={x.id}>{x.label}{x.expected ? " (expected)" : ""}</option>)}
        </select>
      </label>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack" style={{ gap: 4 }}><span className="muted">{k.dates?.issued ?? "Issued (or course passed)"}</span>
          <input id="cert-issued" className="txt" type="date" max={today} value={issued} onChange={(e) => pickIssued(e.target.value)} required /></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">{k.dates?.expires ?? "Runs out"}</span>
          <input id="cert-expires" className="txt" type="date" min={issued || undefined} value={expires} onChange={(e) => { setExpires(e.target.value); setTouched(true); }} /></label>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {kind === "right_to_work"
          ? "Leave the follow-up date blank if their right to work isn't time-limited. Keep copies of documents in your secure HR file, not here."
          : k.renewYears
            ? `Suggested: ${k.renewYears} years after it was issued, when a refresher is due. Change it to the date on the certificate if there is one, or clear it.`
            : "This one doesn't usually expire. Leave the date blank unless the certificate gives one."}
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <input className="txt wide" maxLength={120} placeholder="Provider, e.g. Highfield, FSA, St John" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider" />
        {!k.noReference && <input className="txt wide" maxLength={120} placeholder="Certificate number (optional)" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Certificate number" />}
      </div>
      <input className="txt wide" style={{ maxWidth: "none" }} maxLength={300} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <button className="btn accent" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
