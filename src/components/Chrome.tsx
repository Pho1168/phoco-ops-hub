import Link from "next/link";
import { store } from "@/lib/data";
import { canUsePrep } from "@/lib/domain/prep";
import { signOut } from "@/app/actions";
import type { Ctx } from "@/lib/session";
import { Icon } from "./Icon";

export function TopBar({ ctx }: { ctx: Ctx }) {
  return (
    <header className="top">
      <div className="logo">PHO &amp; CO</div>
      <span className="chip" style={{ background: "color-mix(in srgb, var(--brand-ink) 16%, transparent)", color: "var(--brand-ink)" }}>{ctx.site.name}</span>
      <div className="who">
        <span>{ctx.person.name}</span>
        <form action={signOut}><button className="pill-btn" type="submit">Switch user</button></form>
      </div>
    </header>
  );
}

export async function BottomNav({ ctx, current }: { ctx: Ctx; current: "today" | "prep" | "handover" | "owner" }) {
  const prep = canUsePrep(ctx.access, ctx.isManager) && (await store().prepEnabledSites()).includes(ctx.site.id);
  const item = (href: string, id: typeof current, label: string, icon: string) => (
    <Link href={href} aria-current={current === id ? "page" : undefined}><Icon name={icon} />{label}</Link>
  );
  return (
    <nav className="nav" aria-label="Main">
      {item("/today", "today", "Today", "today")}
      {prep && item("/prep/report", "prep", "Prep", "prep")}
      {item("/handover", "handover", "Handover", "handover")}
      {ctx.isOwner && item("/owner", "owner", "Owner", "owner")}
    </nav>
  );
}
