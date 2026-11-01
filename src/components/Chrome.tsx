import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Ctx } from "@/lib/session";
import { managedSites } from "@/lib/domain/access";
import { firstName } from "@/lib/domain/names";
import { londonDate, longDay } from "@/lib/domain/time";
import { Clock } from "./Clock";
import { Icon } from "./Icon";
import { BrandStyle, Logo } from "./Logo";
import { SiteSwitch } from "./SiteSwitch";
import { store } from "@/lib/data";
import { canSwitchTo, worksAcrossBusinesses } from "@/lib/domain/access";
import { BRAND_IDS, BRANDS } from "@/lib/domain/brand";
import { brandOf, NEUTRAL } from "@/lib/domain/brand";

interface BarProps {
  ctx: Ctx;
  /** The screen's name, shown big in the bar. A page that passes it renders no h1 of its own. */
  title?: React.ReactNode;
  /** The small line above the title; the site and today's date unless the page says otherwise. */
  eyebrow?: React.ReactNode;
  /** A link back to where this screen was opened from, shown as an arrow before the title. */
  back?: string;
  /** Anything the screen wants beside the clock: a switch, a badge, a button. */
  children?: React.ReactNode;
  /** An owner's screen (overview, accounts, ordering): the neutral Ops Hub look, not the site's business. */
  neutral?: boolean;
}

function Brand({ ctx, title, eyebrow, back, neutral }: BarProps) {
  const brand = neutral ? NEUTRAL : brandOf(ctx.site);
  if (!title) {
    return (
      <>
        <BrandStyle brand={brand} />
        <Logo className="top-logo" brand={brand} />
        <span className="top-site">{ctx.site.name}</span>
      </>
    );
  }
  return (
    <>
      <BrandStyle brand={brand} />
      {back
        ? <Link className="pill-btn top-back" href={back} aria-label="Back"><Icon name="back" /></Link>
        : <Logo className="top-logo" brand={brand} />}
      <div className="top-ttl">
        <span className="top-eyebrow">{eyebrow ?? <>{ctx.site.name} · {longDay(londonDate(Date.now()))}</>}</span>
        <h1 className="top-h1">{title}</h1>
      </div>
    </>
  );
}

/**
 * The sites to switch to from any screen, by business. Owners and operations managers: the sites they run. Anyone
 * else: only on their own phone, and only when they work for both businesses, so one sign-in shows either rota.
 */
async function siteChoices(ctx: Ctx) {
  const all = await store().sites();
  if (!ctx.isLead && !(ctx.scope === "shifts" && worksAcrossBusinesses(ctx.person, all))) return undefined;
  const sites = all.filter((s) => s.status === "open" && canSwitchTo(ctx.person, s));
  if (sites.length < 2) return undefined;
  return BRAND_IDS.map((b) => ({ name: BRANDS[b].name, sites: sites.filter((s) => brandOf(s).id === b).map((s) => ({ id: s.id, name: s.name })) }))
    .filter((g) => g.sites.length > 0);
}

/** The bar at the top of every screen on a site tablet (and an owner's or ops manager's own device). */
export async function TopBar(props: BarProps) {
  const { ctx, children } = props;
  const choices = await siteChoices(ctx);
  return (
    <header className="top">
      <Brand {...props} />
      <div className="grow" />
      {children}
      {choices && <SiteSwitch current={ctx.site.id} groups={choices} />}
      <Clock />
      <form className="who" action={signOut}>
        <span className="who-name">{firstName(ctx.person.name)}</span>
        <button className="pill-btn" type="submit" aria-label="Switch user"><span className="sw-text">Switch user</span><Icon name="switch" /></button>
      </form>
    </header>
  );
}

/** The bar on a staff member's own phone (My shifts scope): back to My shifts (unless this is it), sign out. */
export async function PhoneTopBar(props: BarProps & { home?: boolean }) {
  const { ctx, children, home } = props;
  const choices = await siteChoices(ctx);
  return (
    <header className="top">
      <Brand {...props} />
      <div className="grow" />
      {children}
      {choices && <SiteSwitch current={ctx.site.id} groups={choices} />}
      <form className="who" action={signOut}>
        <span className="who-name">{firstName(ctx.person.name)}</span>
        {!home && <Link className="pill-btn" href="/me" aria-label="My shifts"><span className="sw-text">My shifts</span><Icon name="clock" /></Link>}
        <button className="pill-btn" type="submit" aria-label="Sign out"><span className="sw-text">Sign out</span><Icon name="switch" /></button>
      </form>
    </header>
  );
}

/** The tabs. "Today" (everything at the site) is reached from the Shift screen's More row and keeps its tab highlight there. */
export function BottomNav({ ctx, current }: { ctx: Ctx; current: "shift" | "today" | "handover" | "rota" | "library" | "owner" | "manage" | "stock" }) {
  const item = (href: string, id: typeof current, label: string, icon: string, also?: typeof current) => (
    <Link href={href} aria-current={current === id || current === also ? "page" : undefined}><Icon name={icon} />{label}</Link>
  );
  return (
    <nav className="nav" aria-label="Main">
      {item("/shift", "shift", "Shift", "clock", "today")}
      {item("/handover", "handover", "Handover", "handover")}
      {item("/rota", "rota", "Rota", "rota")}
      {item("/library", "library", "Library", "book")}
      {item("/stock", "stock", "Stock", "box")}
      {ctx.isLead
        ? item("/owner", "owner", ctx.isOwner ? "Owner" : "Overview", "owner")
        : managedSites(ctx.person).length > 0 && item("/manage", "manage", "Manage", "manage")}
    </nav>
  );
}
