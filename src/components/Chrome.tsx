import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Ctx } from "@/lib/session";
import { managedSites } from "@/lib/domain/access";
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

/** The header on a staff member's own phone (My shifts scope): back to My shifts, sign out. */
export function PhoneTopBar({ ctx }: { ctx: Ctx }) {
  return (
    <header className="top">
      <div className="logo">PHO &amp; CO</div>
      <div className="who">
        <span>{ctx.person.name}</span>
        <Link className="pill-btn" href="/me">My shifts</Link>
        <form action={signOut}><button className="pill-btn" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}

/** The tabs. "Today" (everything at the site) is reached from the Shift screen's More row and keeps its tab highlight there. */
export function BottomNav({ ctx, current }: { ctx: Ctx; current: "shift" | "today" | "handover" | "rota" | "library" | "owner" | "manage" }) {
  const item = (href: string, id: typeof current, label: string, icon: string, also?: typeof current) => (
    <Link href={href} aria-current={current === id || current === also ? "page" : undefined}><Icon name={icon} />{label}</Link>
  );
  return (
    <nav className="nav" aria-label="Main">
      {item("/shift", "shift", "Shift", "clock", "today")}
      {item("/handover", "handover", "Handover", "handover")}
      {item("/rota", "rota", "Rota", "rota")}
      {item("/library", "library", "Library", "book")}
      {ctx.isLead
        ? item("/owner", "owner", ctx.isOwner ? "Owner" : "Overview", "owner")
        : managedSites(ctx.person).length > 0 && item("/manage", "manage", "Manage", "manage")}
    </nav>
  );
}
