import { redirect } from "next/navigation";

/** Old address: handover reports now live under the Handover tab. */
export default function OldPrepReport({ searchParams }: { searchParams: { id?: string } }) {
  redirect(searchParams.id ? `/handover/report?id=${encodeURIComponent(searchParams.id)}` : "/handover");
}
