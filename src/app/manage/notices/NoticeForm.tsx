"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postNotice } from "@/app/actions";

type Sec = "FOH" | "BOH" | "PROD";

/** Post a notice. "Important" also sends it to the phones of people it's for. */
export function NoticeForm({ sites, canAllSites, today }: { sites: { id: string; name: string; sections: Sec[] }[]; canAllSites: boolean; today: string }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<string>(sites.length === 1 || !canAllSites ? sites[0]?.id ?? "" : "");
  const [sections, setSections] = useState<Sec[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [showUntil, setShowUntil] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const available: Sec[] = siteId ? sites.find((s) => s.id === siteId)?.sections ?? [] : Array.from(new Set(sites.flatMap((s) => s.sections)));
  const toggle = (s: Sec) => setSections((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = () => start(async () => {
    setErr(""); setMsg("");
    const r = await postNotice({ siteId: siteId || null, sections: sections.filter((s) => available.includes(s)), title, body, important, showUntil: showUntil || null });
    if (!r.ok) { setErr(r.error); return; }
    setTitle(""); setBody(""); setImportant(false); setShowUntil(""); setSections([]);
    setMsg(important ? `Posted. Sent to ${r.sentTo ?? 0} phone${r.sentTo === 1 ? "" : "s"} with notifications on; everyone else sees it when they next sign in.` : "Posted. Staff see it when they next open the app.");
    router.refresh();
  });

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2 className="h-sec">Post a notice</h2>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="row" style={{ gap: 6 }}><span className="muted">For</span>
          <select id="notice-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {canAllSites && sites.length > 1 && <option value="">All sites</option>}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Sections">
          <button type="button" className="choice pick" aria-pressed={sections.length === 0} onClick={() => setSections([])}>Everyone</button>
          {available.map((s) => <button key={s} type="button" className="choice pick" aria-pressed={sections.includes(s)} onClick={() => toggle(s)}>{s} only</button>)}
        </div>
      </div>
      <input id="notice-title" className="txt wide" style={{ maxWidth: "none" }} maxLength={120} placeholder="Title, e.g. New lunch menu from Monday" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <textarea id="notice-body" maxLength={2000} placeholder="What does the team need to know?" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Notice" />
      <div className="row wrap" style={{ gap: 14 }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={important} onChange={(e) => setImportant(e.target.checked)} /><span>Important: also send to phones</span></label>
        <label className="row" style={{ gap: 6 }}><span className="muted">Show until (optional)</span><input className="txt" style={{ width: 160 }} type="date" min={today} value={showUntil} onChange={(e) => setShowUntil(e.target.value)} /></label>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <button className="btn accent" type="submit" disabled={pending}>{pending ? "Posting…" : "Post notice"}</button>
    </form>
  );
}
