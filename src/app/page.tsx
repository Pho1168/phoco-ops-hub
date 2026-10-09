import { redirect } from "next/navigation";
import { current } from "@/lib/session";

export default async function Home() {
  const ctx = await current();
  redirect(ctx ? (ctx.isOwner ? "/owner" : "/today") : "/login");
}
