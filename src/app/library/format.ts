import { SECTION_TEXT } from "@/lib/domain/library";

/** "Back of house", "Front of house and Back of house", or "Everyone". */
export const whoFor = (sections: string[]) => (sections.length ? sections.map((s) => SECTION_TEXT[s as keyof typeof SECTION_TEXT] ?? s).join(" and ") : "Everyone");
export const dayMonth = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
export const dayMonthYearAt = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
