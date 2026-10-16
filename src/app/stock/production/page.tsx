import { redirect } from "next/navigation";

/** Folded into the simpler stock screens: this address now goes to /stock/needed. */
export default function Moved() {
  redirect("/stock/needed");
}
