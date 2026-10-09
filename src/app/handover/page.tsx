import { addHandover, closeHandover } from "@/app/actions";
import { store } from "@/lib/data";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";

export const dynamic = "force-dynamic";
const CATEGORIES = ["Equipment", "Stock shortage", "Food safety", "Customer complaint", "Staff note"];
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function Handover() {
  const ctx = await requireCtx();
  const items = (await store().handover(ctx.site.id)).filter((h) => !h.closedAt);
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">{ctx.site.name} · shift handover</div><h1 className="h-display">Handover</h1></div>
        <form action={addHandover} className="card stack">
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong">What should the next shift know?</span>
            <textarea id="ho-body" name="body" required maxLength={1000} placeholder="e.g. Fridge 3 door not closing properly, engineer booked for Monday" />
          </label>
          <div className="row wrap">
            <label className="row" style={{ gap: 8 }}><span className="muted">Type</span>
              <select id="ho-cat" name="category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input id="ho-action" type="checkbox" name="needsAction" defaultChecked style={{ width: 22, height: 22 }} />
              <span>Needs action (stays open until done)</span>
            </label>
          </div>
          <button className="btn accent" type="submit">Add to handover</button>
        </form>
        <section className="stack">
          <h2 className="h-sec">Open items</h2>
          {items.length === 0 && <div className="card muted">Nothing handed over yet. Items marked &quot;Needs action&quot; show on the next shift&apos;s Today screen until someone closes them.</div>}
          {items.map((h) => (
            <div key={h.id} className="card row">
              <span className={`chip ${h.needsAction ? "late" : ""}`}>{h.category}</span>
              <div className="grow"><div>{h.body}</div><div className="muted">{h.createdByName} · {time(h.createdAt)}{h.needsAction ? " · carries over until closed" : ""}</div></div>
              <form action={closeHandover.bind(null, h.id)}><button className="btn ghost small" type="submit">Done</button></form>
            </div>
          ))}
        </section>
      </main>
      <BottomNav ctx={ctx} current="handover" />
    </>
  );
}
