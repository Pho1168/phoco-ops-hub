import Link from "next/link";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { BRANDS, brandOf } from "@/lib/domain/brand";
import { ManageTiles, NeedsYou } from "./ManageTiles";
import { manageCounts } from "./counts";

export const dynamic = "force-dynamic";

/** Manager home: the tools for the sites they run. Owners see the same tiles at the top of the Owner screen. */
export default async function Manage() {
  const ctx = await requireManager();
  const counts = await manageCounts(ctx.person, ctx.site);
  return (
    <>
      <TopBar ctx={ctx} title="Manage" eyebrow={`${ctx.isOwner || ctx.isOps ? BRANDS[brandOf(ctx.site).id].name : ctx.site.name} · manager tools`} />
      <main className="wide">
        <section className="stack panel nude" aria-label="Needs you" style={{ gap: 8 }}>
          <h2 className="grp-h">Needs you <span>most pressing first</span></h2>
          <NeedsYou counts={counts} />
        </section>
        <ManageTiles counts={counts} />
        {ctx.isOwner && <Link className="btn ghost" href="/owner">Owner controls: sites, staff, tablets, rota sheets</Link>}
        {ctx.isOps && <Link className="btn ghost" href="/owner">Overview: your sites, staff and tablets</Link>}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
