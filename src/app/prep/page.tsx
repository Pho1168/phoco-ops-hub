import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Old address: the prep handover now lives under the Handover tab. */
export default function OldPrep() { redirect("/handover/prep"); }
