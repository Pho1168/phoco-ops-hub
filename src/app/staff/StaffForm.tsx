"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPerson, resetPin, setLeft, updatePerson } from "@/app/actions";
import type { Area, Role, SiteAccess, SiteId } from "@/lib/domain/types";

export interface SiteOpt { id: SiteId; name: string; sections: Area[]; closed: boolean }
export interface PersonView { id: string; staffCode: string; name: string; status: string; self: boolean; access: SiteAccess[] }

const ROLE_LABEL: Record<Role, string> = { staff: "Staff", manager: "Manager", owner: "Owner" };
const AREA_LABEL: Record<Area, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

export function StaffForm({ sites, person, suggestedCode }: { sites: SiteOpt[]; person?: PersonView; suggestedCode: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(person?.name ?? "");
  const [code, setCode] = useState(person?.staffCode ?? suggestedCode);
  const [access, setAccess] = useState<SiteAccess[]>(person?.access ?? []);
  const [tempPin, setTempPin] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const at = (id: SiteId) => access.find((a) => a.siteId === id);
  const toggleSite = (s: SiteOpt, on: boolean) =>
    setAccess((cur) => on ? [...cur, { siteId: s.id, role: "staff", sections: s.sections.length === 1 ? s.sections : [] }] : cur.filter((a) => a.siteId !== s.id));
  const patch = (id: SiteId, p: Partial<SiteAccess>) => setAccess((cur) => cur.map((a) => (a.siteId === id ? { ...a, ...p } : a)));

  const submit = () => start(async () => {
    setErr(""); setMsg("");
    const input = { staffCode: code, name, access };
    if (person) {
      const r = await updatePerson(person.id, input);
      if (!r.ok) setErr(r.error); else { setMsg("Saved"); router.refresh(); }
    } else {
      const r = await createPerson(input, tempPin);
      if (!r.ok) setErr(r.error); else router.replace(`/staff/${r.id}?added=1`);
    }
  });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="h-sec">Details</h2>
        <label className="stack" style={{ gap: 6 }}><span className="strong" style={{ fontSize: 15 }}>Name shown on the sign-in screen</span>
          <input id="staff-name" className="txt wide" required maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mai T." /></label>
        <label className="stack" style={{ gap: 6 }}><span className="strong" style={{ fontSize: 15 }}>Staff ID</span>
          <input id="staff-code" className="txt wide" required maxLength={3} inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <span className="muted">Three digits, e.g. 009. Must match the Staff ID column in the rota sheet.</span></label>

        <h2 className="h-sec" style={{ marginTop: 6 }}>Sites and roles</h2>
        {sites.map((s) => {
          const a = at(s.id);
          return (
            <fieldset key={s.id} className="site-box">
              <legend className="sr-only">{s.name}</legend>
              <label className="row" style={{ gap: 10 }}>
                <input type="checkbox" className="check" checked={!!a} onChange={(e) => toggleSite(s, e.target.checked)} />
                <span className="strong">{s.name}</span>{s.closed && <span className="chip">closed</span>}
              </label>
              {a && (
                <div className="stack" style={{ gap: 10, paddingLeft: 34 }}>
                  <div className="seg" role="group" aria-label={`Role at ${s.name}`}>
                    {(["staff", "manager", "owner"] as Role[]).map((r) => (
                      <button key={r} type="button" aria-pressed={a.role === r} onClick={() => patch(s.id, { role: r })}>{ROLE_LABEL[r]}</button>
                    ))}
                  </div>
                  {a.role !== "owner" && (
                    <div className="row wrap" style={{ gap: 14 }}>
                      {s.sections.map((sec) => (
                        <label key={sec} className="row" style={{ gap: 8 }}>
                          <input type="checkbox" className="check" checked={a.sections.includes(sec)}
                            onChange={(e) => patch(s.id, { sections: e.target.checked ? [...a.sections, sec] : a.sections.filter((x) => x !== sec) })} />
                          <span>{AREA_LABEL[sec]}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {a.role === "owner" && <span className="muted">Owners see every section and the owner controls.</span>}
                </div>
              )}
            </fieldset>
          );
        })}

        {!person && (
          <>
            <h2 className="h-sec" style={{ marginTop: 6 }}>Temporary PIN</h2>
            <label className="stack" style={{ gap: 6 }}>
              <span className="muted">Give this to them in person. They&apos;ll choose their own PIN the first time they sign in.</span>
              <input id="staff-temp-pin" className="num" style={{ width: 140 }} inputMode="numeric" autoComplete="off" maxLength={4} required value={tempPin} onChange={(e) => setTempPin(digits(e.target.value))} />
            </label>
          </>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        {msg && <div className="alert good" role="status"><div className="strong">{msg}</div></div>}
        <div className="row">
          <Link className="btn ghost" href="/owner">Back</Link>
          <button className="btn accent grow" type="submit" disabled={pending}>{person ? "Save changes" : "Add person"}</button>
        </div>
      </form>

      {person && !person.self && <PersonActions person={person} />}
    </div>
  );
}

function PersonActions({ person }: { person: PersonView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const left = person.status === "left";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (!r.ok) setErr(r.error ?? "Something went wrong"); else { setMsg(ok); setPin(""); router.refresh(); }
  });

  return (
    <section className="card stack">
      <h2 className="h-sec">PIN and account</h2>
      {!left && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => resetPin(person.id, pin), `Temporary PIN set. ${person.name} will choose a new one at next sign-in.`); }}>
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong" style={{ fontSize: 15 }}>Forgotten PIN? Set a temporary one</span>
            <span className="muted">Signs them out everywhere. You never see their own PIN.</span>
            <div className="row">
              <input id="reset-pin" className="num" style={{ width: 140 }} inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(digits(e.target.value))} />
              <button className="btn" type="submit" disabled={pending || pin.length < 4}>Set temporary PIN</button>
            </div>
          </label>
        </form>
      )}
      <div className="row wrap" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div className="grow">
          <div className="strong" style={{ fontSize: 15 }}>{left ? "Marked as left" : "Leaving the business?"}</div>
          <div className="muted">{left ? "They can't sign in. Their past records are kept." : "Ends their access for good. Their past records are kept."}</div>
        </div>
        {left
          ? <button className="btn" type="button" disabled={pending} onClick={() => run(() => setLeft(person.id, false), `${person.name} can sign in again`)}>Rejoin</button>
          : <button className="btn bad" type="button" disabled={pending} onClick={() => { if (confirm(`Mark ${person.name} as left? They won't be able to sign in.`)) run(() => setLeft(person.id, true), `${person.name} marked as left`); }}>Mark as left</button>}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
    </section>
  );
}
