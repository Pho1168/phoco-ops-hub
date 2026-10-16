import { ROUND_LABEL, type RoundState } from "@/lib/domain/supplier-orders";

const TONE: Record<RoundState, string> = { counting: "", review: "sup-now", generated: "sup-now", ordered: "sup-brand", delivered: "done", short: "late", missed: "bad" };

/** Where a supplier round stands, as a chip: waiting (plain), ready or made (amber, "now"), ordered (deep teal), delivered, short, missed. */
export function RoundChip({ state }: { state: RoundState }) {
  return <span className={`chip ${TONE[state]}`}>{ROUND_LABEL[state]}</span>;
}

/** A date as "Monday 19 Oct" (the weekday in full, once). */
export const dayDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
