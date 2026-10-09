export type SiteId = "EAS" | "WEM" | "SYD";
export type Area = "FOH" | "BOH" | "PROD";
export type Role = "owner" | "manager" | "staff";
export type AnswerType = "tick" | "temp" | "number" | "text" | "photo";
export type Outcome = "todo" | "done" | "ok" | "warn" | "bad";

export interface Site {
  id: SiteId;
  name: string;
  kind: "restaurant" | "production";
  status: "open" | "closed";
  closedReason?: string;
}

export interface SiteAccess {
  siteId: SiteId;
  role: Role;
  sections: Area[];
}

export interface Person {
  id: string;
  staffCode: string;
  name: string;
  status: "active" | "frozen" | "left";
  /** Why the account is frozen: "owner" (individually) or "site:EAS" (site closure). */
  frozenReason?: string;
  pinHash?: string;
  pinFailed: number;
  pinLockedUntil?: number; // epoch ms
  access: SiteAccess[];
}

/** Approved limits. Values come from the HACCP plan (temp_rules table), never hard-coded in screens. */
export interface TempRule {
  code: string;
  label: string;
  targetMax?: number;
  targetMin?: number;
  legalMax?: number;
  legalMin?: number;
}

export interface ChecklistItem {
  id: string;
  position: number;
  section: string;
  text: string;
  type: AnswerType;
  ruleCode?: string;
  hint?: string;
  tag?: string;
}

export interface Checklist {
  id: string;
  siteId: SiteId;
  name: string;
  area: Area;
  when: string;
  due?: string; // "HH:MM"
  suggested: boolean;
  items: ChecklistItem[];
}

export interface Answer {
  itemId: string;
  value: string;
  outcome: Outcome;
  action?: string;
  recordedBy: string;
  capturedAt: number;
}
