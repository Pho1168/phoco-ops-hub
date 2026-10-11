"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readNotice } from "@/app/actions";
import { Icon } from "./Icon";

export interface BannerNotice { id: string; title: string; body: string; important: boolean; from: string; when: string }

/** Unread team notices for the person signed in. Each stays until they tap "Got it". */
export function NoticeBanner({ notices }: { notices: BannerNotice[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [, start] = useTransition();
  const shown = notices.filter((n) => !gone.has(n.id));
  if (!shown.length && !err) return null;
  const got = (id: string) => {
    setErr(""); setGone((g) => new Set(g).add(id));
    start(async () => {
      const r = await readNotice(id);
      if (!r.ok) { setErr(r.error); setGone((g) => { const n = new Set(g); n.delete(id); return n; }); }
      router.refresh();
    });
  };
  return (
    <section className="stack" aria-label="Team notices">
      {err && <div className="err" role="alert">{err}</div>}
      {shown.map((n) => (
        <div key={n.id} className={`notice ${n.important ? "important" : ""}`}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="notice-ico"><Icon name="notice" /></span>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>{n.important && <span className="chip bad">Important</span>}<span className="muted">{n.from} · {n.when}</span></div>
              <div className="strong" style={{ fontSize: 17, marginTop: 2 }}>{n.title}</div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{n.body}</div>
            </div>
          </div>
          <button type="button" className="btn accent small" onClick={() => got(n.id)}>Got it</button>
        </div>
      ))}
    </section>
  );
}
