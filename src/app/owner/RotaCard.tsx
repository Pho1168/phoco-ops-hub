"use client";

import { useState, useTransition } from "react";
import { connectRotaSheet } from "@/app/actions";

export interface RotaRow { siteId: string; site: string; connected: boolean; last?: string; summary?: string; published?: string; issues: string[] }

export function RotaCard({ rows }: { rows: RotaRow[] }) {
  const [pending, start] = useTransition();
  const [script, setScript] = useState<{ site: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  return (
    <section className="card stack" aria-label="Rota">
      <h2 className="h-sec">Rota sheets</h2>
      <p className="muted" style={{ margin: 0 }}>Each site&apos;s Google Sheet sends its rota here every hour. Only Published weeks are shown to staff or send reminders.</p>
      <ul className="accounts">
        {rows.map((r) => (
          <li key={r.siteId} style={{ alignItems: "flex-start" }}>
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="strong">{r.site}</div>
              <div className="muted">{!r.connected ? "Not connected yet" : r.last ? `Last received ${r.last} · ${r.summary}` : "Connected, waiting for the sheet to send"}</div>
              {r.published && <div className="muted">Newly published: {r.published}</div>}
              {r.issues.length > 0 && (
                <details><summary className="muted" style={{ cursor: "pointer" }}>{r.issues.length} thing{r.issues.length > 1 ? "s" : ""} to check in the sheet</summary>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>{r.issues.map((i, k) => <li key={k}>{i}</li>)}</ul></details>
              )}
            </div>
            <span className="acct-actions">
              <button type="button" className={`btn small ${r.connected ? "ghost" : "accent"}`} disabled={pending} onClick={() => {
                if (r.connected && !confirm(`Create a new connection for ${r.site}? The script already in the sheet will stop working until you paste the new one.`)) return;
                start(async () => {
                  setErr(""); setCopied(false);
                  const res = await connectRotaSheet(r.siteId);
                  if (!res.ok || !res.script) setErr(res.ok ? "Something went wrong" : res.error); else setScript({ site: r.site, text: res.script });
                });
              }}>{r.connected ? "New connection" : "Connect sheet"}</button>
            </span>
          </li>
        ))}
      </ul>
      {err && <div className="err" role="alert">{err}</div>}
      {script && (
        <div className="site-box stack">
          <div className="strong">Connect the {script.site} rota sheet</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Open the {script.site} rota in Google Sheets on a computer.</li>
            <li>Click <strong>Extensions → Apps Script</strong>. Delete anything in the editor.</li>
            <li>Copy the script below and paste it in. Click the <strong>Save</strong> icon.</li>
            <li>Choose <strong>setUp</strong> in the function list at the top, click <strong>Run</strong>, and allow access when Google asks.</li>
            <li>Back in the sheet you&apos;ll see a message with what was sent. From now on it sends every hour, or use the <strong>Ops Hub</strong> menu after publishing a week.</li>
          </ol>
          <textarea className="script-box" readOnly value={script.text} onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <button type="button" className="btn accent grow" onClick={async () => { await navigator.clipboard.writeText(script.text); setCopied(true); }}>{copied ? "Copied" : "Copy script"}</button>
            <button type="button" className="btn ghost" onClick={() => setScript(null)}>Done</button>
          </div>
          <div className="muted">This script is shown once. It contains a private key for {script.site}, so don&apos;t share it.</div>
        </div>
      )}
    </section>
  );
}
