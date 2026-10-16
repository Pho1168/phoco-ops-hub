import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import type { Ctx } from "@/lib/session";

/** The bar for a Stock screen: the tablet's (with the tabs below) or the phone's (back to My shifts). */
export function StockBar({ ctx, onPhone, title, eyebrow, back }: { ctx: Ctx; onPhone: boolean; title: string; eyebrow?: string; back?: string }) {
  return onPhone
    ? <PhoneTopBar ctx={ctx} title={title} eyebrow={eyebrow ?? `Stock · ${ctx.site.name}`} back={back} />
    : <TopBar ctx={ctx} title={title} eyebrow={eyebrow ?? `Stock · ${ctx.site.name}`} back={back} />;
}

export function StockNav({ ctx, onPhone }: { ctx: Ctx; onPhone: boolean }) {
  return onPhone ? null : <BottomNav ctx={ctx} current="stock" />;
}
