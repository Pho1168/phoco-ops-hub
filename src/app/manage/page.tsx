import Link from "next/link";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { ManageTiles } from "./ManageTiles";
import { manageCounts } from "./counts";

export const dynamic = "force-dynamic";

/** Manager home: the tools for the sites they run. Owners see the same tiles at the top of the Owner screen. */
export default async function Manage() {
  const ctx = await requireManager();
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">{ctx.isOwner ? "All sites" : ctx.site.name} · manager tools</div><h1 className="h-display">Manage</h1></div>
        <ManageTiles counts={await manageCounts(ctx.person)} />
        {ctx.isOwner && <Link className="btn ghost" href="/owner">Owner controls: sites, staff, tablets, rota sheets</Link>}
      </main>
      <BottomNav ctx={ctx} current={ctx.isOwner ? "owner" : "manage"} />
    </>
  );
}
