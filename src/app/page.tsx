import { redirect } from "next/navigation";
import { current } from "@/lib/session";

export default async function Home() {
  const ctx = await current();
  redirect(!ctx ? "/login" : ctx.person.pinMustChange ? "/pin" : ctx.isOwner ? "/owner" : "/today");
}
