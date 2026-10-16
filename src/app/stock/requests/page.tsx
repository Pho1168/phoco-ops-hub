import Link from "next/link";
import { store } from "@/lib/data";
import { isClosed, productLabel, reqCode, STATE_LABEL, wantedOf } from "@/lib/domain/stock";
import { shortDay, londonDate } from "@/lib/domain/time";
import { stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { qtyText, stockCtx } from "../load";
import { ReceiveForm } from "./ReceiveForm";

export const dynamic = "force-dynamic";

/** A restaurant's requests: what to confirm when it arrives, what's in hand, what's finished lately. */
export default async function Requests(props: { searchParams: Promise<{ site?: string }> }) {
  const sp = await props.searchParams;
  const { ctx, onPhone } = await stockCtx();
  const db = store();
  const now = Date.now();
  const sites = (await db.sites()).filter((s) => ctx.person.access.some((a) => a.siteId === s.id));
  const site = sites.find((s) => s.id === sp.site) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  const { catalog, items } = await stockView(db, now, site ? [site.id] : []);
  const name = (id: string) => { const p = catalog.products.find((x) => x.id === id); return p ? productLabel(p) : "Product"; };
  const toReceive = items.filter((x) => x.progress.toReceive > 0);
  const inHand = items.filter((x) => !isClosed(x.progress) && x.progress.toReceive === 0);
  const recent = items.filter((x) => isClosed(x.progress) && now - x.request.createdAt < 14 * 86_400_000);

  const row = (x: (typeof items)[number], extra?: React.ReactNode) => (
    <li key={x.request.id} className="stock-line">
      <div className="row wrap" style={{ gap: 10 }}>
        <Link className="grow strong" href={`/stock/request/${x.request.id}`} style={{ color: "inherit" }}>{name(x.request.productId)}</Link>
        <span className={`chip ${x.request.level === "out" ? "bad" : "warn"}`}>{x.request.level === "out" ? "Out" : "Low"}</span>
        <span className={`chip ${x.progress.state === "received" ? "done" : x.progress.state === "cancelled" ? "" : "late"}`}>{STATE_LABEL[x.progress.state]}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {reqCode(x.request)} · asked for {qtyText(wantedOf(x.request))} by {x.request.requestedByName?.split(" ")[0] ?? "someone"}, {shortDay(londonDate(x.request.createdAt))}
        {x.progress.obtained > 0 && ` · ${qtyText(x.progress.obtained)} sent, ${qtyText(x.progress.received)} received`}
      </div>
      {extra}
    </li>
  );

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Requests" back="/stock" eyebrow={`Stock · ${site?.name ?? ""}`} />
      <main className="stack">
        {sites.length > 1 && (
          <div className="chips stock-cats" role="group" aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site?.id ? "done" : ""}`} href={`/stock/requests?site=${s.id}`}>{s.name}</Link>)}
          </div>
        )}
        <section className="stack" aria-label="To confirm" id="receive" style={{ gap: 8 }}>
          <h2 className="h-sec">When it arrives ({toReceive.length})</h2>
          {!toReceive.length && <div className="card muted">Nothing on its way. Bought or sent items show here to confirm.</div>}
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
            {toReceive.map((x) => row(x, <ReceiveForm requestId={x.request.id} expected={x.progress.toReceive} />))}
          </ul>
        </section>
        <section className="stack" aria-label="In hand" style={{ gap: 8 }}>
          <h2 className="h-sec">In hand ({inHand.length})</h2>
          {!inHand.length && <div className="card muted">Nothing waiting. <Link href="/stock/report">Report stock</Link></div>}
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>{inHand.map((x) => row(x))}</ul>
        </section>
        {recent.length > 0 && (
          <section className="stack" aria-label="Finished" style={{ gap: 8 }}>
            <h2 className="h-sec">Finished in the last 2 weeks ({recent.length})</h2>
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>{recent.map((x) => row(x))}</ul>
          </section>
        )}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
