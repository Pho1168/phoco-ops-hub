import { redirect } from "next/navigation";

/** Old address: handover reports now live under the Handover tab. */
export default async function OldPrepReport(props: { searchParams: Promise<{ id?: string }> }) {
  const searchParams = await props.searchParams;
  redirect(searchParams.id ? `/handover/report?id=${encodeURIComponent(searchParams.id)}` : "/handover");
}
