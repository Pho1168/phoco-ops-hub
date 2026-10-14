import { redirect } from "next/navigation";
import { current } from "@/lib/session";

export default async function Home() {
  const ctx = await current();
  // Owners and operations managers land on the overview; everyone else on their shift (My shifts on a phone with no shift today).
  redirect(!ctx ? "/login" : ctx.person.pinMustChange ? "/pin" : ctx.isLead && ctx.scope === "full" ? "/owner" : "/shift");
}
