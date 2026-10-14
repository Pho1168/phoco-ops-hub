import { redirect } from "next/navigation";
import { current } from "@/lib/session";
import { PIN_RULE } from "@/lib/domain/pin";
import { PhoneTopBar, TopBar } from "@/components/Chrome";
import { PinForm } from "./PinForm";

export const dynamic = "force-dynamic";

export default async function PinPage() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  const first = !!ctx.person.pinMustChange;
  const Bar = ctx.scope === "full" ? TopBar : PhoneTopBar;
  return (
    <>
      <Bar ctx={ctx} title={first ? "Choose your PIN" : "Change my PIN"} eyebrow={`${ctx.person.name} · ${ctx.site.name}`} back={first ? undefined : "/"} />
      <main className="login" style={{ paddingTop: 24 }}>
        <div className="panel stack" style={{ gap: 6 }}>
          <p style={{ margin: 0 }}>
            {first
              ? "You signed in with a temporary PIN. Choose your own now. Keep it to yourself: it's how the app knows a check or sign-off was really you."
              : "Your PIN signs your checks, so keep it private."}
          </p>
          <p className="muted" style={{ margin: 0 }}>{PIN_RULE}</p>
        </div>
        <PinForm first={first} />
      </main>
    </>
  );
}
