export type SiteId = "EAS" | "WEM" | "SYD";
export type Area = "FOH" | "BOH" | "PROD";
/** Per site. "ops" is an operations manager: above the site managers, below the owner. */
export type Role = "owner" | "ops" | "manager" | "staff";
export type AnswerType = "tick" | "temp" | "number" | "text" | "photo";
export type Outcome = "todo" | "done" | "ok" | "warn" | "bad";

export interface Site {
  id: SiteId;
  name: string;
  kind: "restaurant" | "production";
  status: "open" | "closed";
  closedReason?: string;
  /** "12:00": the opening checks must be signed by then (ready to open). */
  readyBy?: string;
  /** "21:30": the kitchen closes and the gas check is due (gas off at close). Unset: when the last shift ends. */
  gasBy?: string;
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
  /** Set when an owner gives a temporary PIN; the person must choose their own before doing anything else. */
  pinMustChange?: boolean;
  /** May see and record right to work checks. Only the owner asked for this; nobody else unless they decide. */
  seesRightToWork?: boolean;
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

/** One numbered version of a checklist's items. Runs are signed against a version, so a published one never changes. */
export interface ChecklistVersion {
  id: string;
  templateId: string;
  version: number;
  status: "draft" | "published" | "retired" | "discarded";
  items: ChecklistItem[];
  note?: string;
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
  publishedBy?: string;
}

/** A checklist as the owner edits it: its settings, the version in use and the draft, if any. */
export interface ChecklistTemplate {
  id: string;
  siteId: SiteId;
  name: string;
  area: Area;
  when: string;
  due?: string;
  suggested: boolean;
  active: boolean;
  published?: ChecklistVersion;
  draft?: ChecklistVersion;
}

export interface Answer {
  itemId: string;
  value: string;
  outcome: Outcome;
  action?: string;
  recordedBy: string;
  capturedAt: number;
}
