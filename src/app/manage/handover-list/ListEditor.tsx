"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { movePrepItem, savePrepItem, setPrepItemActive } from "@/app/actions";
import { filterPrep, prepGroups, PREP_GROUP_MAX, PREP_KINDS, PREP_NAME_MAX, type PrepItem, type PrepKind } from "@/lib/domain/prep";

interface Draft { name: string; kind: PrepKind; group: string }

/** The fields for an item: what it is, which list, which group (an existing one, or a new one typed in). */
function Fields({ d, set, groups, idp }: { d: Draft; set: (d: Draft) => void; groups: { kind: PrepKind; group: string }[]; idp: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input id={`${idp}-name`} className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={PREP_NAME_MAX} placeholder="e.g. Restock chopsticks"
        aria-label="What it is" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} />
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label="Which list" style={{ flex: "1 1 200px" }}>
          {PREP_KINDS.map((k) => <button key={k.id} type="button" aria-pressed={d.kind === k.id} onClick={() => set({ ...d, kind: k.id })}>{k.label}</button>)}
        </div>
        <input id={`${idp}-group`} className="txt" style={{ flex: "2 1 200px", maxWidth: "none" }} maxLength={PREP_GROUP_MAX} list={`${idp}-groups`}
          placeholder="Group, e.g. Bar & counter" aria-label="Group" value={d.group} onChange={(e) => set({ ...d, group: e.target.value })} />
        <datalist id={`${idp}-groups`}>{groups.filter((g) => g.kind === d.kind).map((g) => <option key={g.group} value={g.group} />)}</datalist>
      </div>
    </div>
  );
}

export function ListEditor({ items, canRetire }: { items: PrepItem[]; canRetire: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState<Draft>({ name: "", kind: "todo", group: "" });
  const [edit, setEdit] = useState<{ id: string; d: Draft } | null>(null);
  const groups = prepGroups(items.filter((i) => i.active));
  const shown = filterPrep(items, "all", "");
  const off = items.filter((i) => !i.active).sort((a, b) => a.name.localeCompare(b.name));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, after?: () => void) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "Something went wrong"); return; }
    after?.();
    if (done) setMsg(done);
    router.refresh();
  });

  return (
    <>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(() => savePrepItem(null, add), `Added "${add.name.trim()}"`, () => setAdd({ ...add, name: "" })); }}>
        <h2 className="h-sec">Add to the list</h2>
        <Fields d={add} set={setAdd} groups={groups} idp="add" />
        <button className="btn accent" type="submit" disabled={pending || !add.name.trim() || !add.group.trim()}>Add</button>
      </form>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}

      {PREP_KINDS.map((k) => {
        const mine = groups.filter((g) => g.kind === k.id);
        const count = shown.filter((i) => i.kind === k.id).length;
        return (
          <section key={k.id} className="stack" aria-label={k.label}>
            <h2 className="h-display" style={{ fontSize: 28 }}>{k.label} ({count})</h2>
            {mine.length === 0 && <div className="card muted">Nothing on this list yet.</div>}
            {mine.map((g) => {
              const list = shown.filter((i) => i.kind === g.kind && i.group === g.group);
              return (
                <div key={g.group} className="card stack" style={{ gap: 6 }}>
                  <h3 className="h-sec" style={{ margin: 0 }}>{g.group}</h3>
                  <ul className="plist">
                    {list.map((i, n) => (
                      <li key={i.id}>
                        {edit?.id === i.id
                          ? (
                            <form className="stack grow" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(() => savePrepItem(i.id, edit.d), "Saved", () => setEdit(null)); }}>
                              <Fields d={edit.d} set={(d) => setEdit({ id: i.id, d })} groups={groups} idp={`e-${i.id}`} />
                              <div className="row" style={{ gap: 8 }}>
                                <button className="btn small accent" type="submit" disabled={pending}>Save</button>
                                <button className="btn small ghost" type="button" onClick={() => setEdit(null)}>Cancel</button>
                                {canRetire && <button className="btn small bad" type="button" disabled={pending} style={{ marginLeft: "auto" }}
                                  onClick={() => { if (confirm(`Take "${i.name}" off the list? Past handovers keep it, and it can be put back.`)) run(() => setPrepItemActive(i.id, false), `Took "${i.name}" off the list`, () => setEdit(null)); }}>
                                  Take off the list</button>}
                              </div>
                            </form>
                          )
                          : (
                            <>
                              <span className="grow">{i.name}</span>
                              <button type="button" className="btn ghost small icon" aria-label={`Move ${i.name} up`} disabled={pending || n === 0} onClick={() => run(() => movePrepItem(i.id, "up"))}>↑</button>
                              <button type="button" className="btn ghost small icon" aria-label={`Move ${i.name} down`} disabled={pending || n === list.length - 1} onClick={() => run(() => movePrepItem(i.id, "down"))}>↓</button>
                              <button type="button" className="btn ghost small" aria-label={`Edit ${i.name}`} onClick={() => { setErr(""); setEdit({ id: i.id, d: { name: i.name, kind: i.kind, group: i.group } }); }}>Edit</button>
                            </>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}

      {off.length > 0 && (
        <details className="card">
          <summary className="strong" style={{ cursor: "pointer" }}>Taken off the list ({off.length})</summary>
          <ul className="plist" style={{ marginTop: 8 }}>
            {off.map((i) => (
              <li key={i.id}>
                <span className="grow">{i.name} <span className="muted">· {PREP_KINDS.find((k) => k.id === i.kind)?.label} · {i.group}</span></span>
                {canRetire && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPrepItemActive(i.id, true), `Put "${i.name}" back`)}>Put back</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!canRetire && <div className="muted" style={{ fontSize: 13 }}>To take something off the list, ask the owner or an operations manager.</div>}
    </>
  );
}
