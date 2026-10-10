import { redirect } from "next/navigation";
import { current } from "@/lib/session";
import { PIN_RULE } from "@/lib/domain/pin";
import { PinForm } from "./PinForm";

export const dynamic = "force-dynamic";

export default async function PinPage() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  const first = !!ctx.person.pinMustChange;
  return (
    <main className="login" style={{ paddingTop: 36 }}>
      <div>
        <div className="eyebrow">{ctx.person.name} · {ctx.site.name}</div>
        <h1 className="h-display" style={{ marginTop: 6 }}>{first ? "Choose your PIN" : "Change my PIN"}</h1>
      </div>
      <p style={{ margin: 0 }}>
        {first
          ? "You signed in with a temporary PIN. Choose your own now. Keep it to yourself: it's how the app knows a check or sign-off was really you."
          : "Your PIN signs your checks, so keep it private."}
      </p>
      <p className="muted" style={{ margin: 0 }}>{PIN_RULE}</p>
      <PinForm first={first} />
    </main>
  );
}
