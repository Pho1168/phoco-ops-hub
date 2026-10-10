import { redirect } from "next/navigation";
import { current } from "@/lib/session";

export default async function Home() {
  const ctx = await current();
  redirect(!ctx ? "/login" : ctx.person.pinMustChange ? "/pin" : ctx.scope === "shifts" ? "/me" : ctx.isOwner ? "/owner" : "/today");
}
