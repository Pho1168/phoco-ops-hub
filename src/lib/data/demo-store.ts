import { randomUUID } from "node:crypto";
import library from "../../../data/checklist-library.json";
import { hashPin } from "@/lib/domain/pin";
import type { Area, Checklist, ChecklistItem, Person, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, HandoverItem, LibraryAck, NoticeRow, PrepEntryView, PrepHandover, PushSub, RotaResult, Run, Session, ShiftView, Store } from "./store";
import { latestAnswers } from "@/lib/domain/checklist";
import { londonDate, londonToUtc, addDays as addDaysIso } from "@/lib/domain/time";
import { masterItems, type PrepEntry, type PrepItem } from "@/lib/domain/prep";
import type { TeamNotice } from "@/lib/domain/notices";
import type { TimeOff } from "@/lib/domain/timeoff";
import type { Certificate } from "@/lib/domain/certificates";
import type { Equipment, EquipmentEvent } from "@/lib/domain/equipment";
import type { Task } from "@/lib/domain/tasks";
import type { ShiftReply } from "@/lib/domain/reminders";
import type { GasCheck } from "@/lib/domain/daily";
import type { CoverRequest, CoverStatus } from "@/lib/domain/cover";
import { nextCode, type BodyOf, type LibraryDoc, type LibraryVersion } from "@/lib/domain/library";
import { ALLERGEN_KEYS } from "@/lib/domain/recipes";
import { shiftEnd, shiftStart } from "@/lib/domain/reminders";
import type { StoredShift, WeekStatus } from "@/lib/domain/rota";
import type { Device } from "@/lib/domain/devices";
import { bySkillOrder, trainingSections, type Pathway, type Question, type Skill, type TrainingEvent, type TrainingStart } from "@/lib/domain/training";

/** Demo-only people. Real staff come from the database, never from the code. */
export const DEMO_PINS = { owner: "4826", staff: "1357" } as const;

const DUE: Record<string, string> = {
  "EAS-FOH-OPEN": "11:30", "EAS-FOH-CLOSE": "22:30", "EAS-FOH-CLEAN": "22:30", "EAS-BAR-PREP": "11:30",
  "EAS-BOH-OPEN": "11:00", "EAS-BOH-CLOSE": "22:30", "EAS-BOH-CLEAN": "22:30", "EAS-TEMP-COLD": "11:00",
  "EAS-TEMP-COOK": "12:00", "WEM-OPEN": "08:00", "WEM-CLOSE": "17:00", "WEM-CLEAN": "17:00",
  "WEM-TEMP-COLD": "08:00", "WEM-TEMP-COOK": "10:00", "WEM-DISPATCH": "10:30",
};

interface LibItem { text: string; type: ChecklistItem["type"]; limit?: string; hint?: string; tag?: string }
interface LibList { id: string; name: string; area: Area; when: string; tag?: string; sections: [string, LibItem[]][] }
type Lib = Record<string, { name: string; checklists: LibList[] }>;

function ruleFor(limit?: string): string | undefined {
  if (!limit) return undefined;
  if (limit.includes("-18")) return "Z";
  if (limit.includes("75")) return "C";
  if (limit.includes("5°C")) return "F";
  return undefined;
}

function buildChecklists(): Checklist[] {
  const out: Checklist[] = [];
  for (const [siteId, site] of Object.entries(library as unknown as Lib)) {
    for (const c of site.checklists) {
      let pos = 0;
      const items: ChecklistItem[] = [];
      for (const [section, its] of c.sections) for (const it of its) {
        pos++;
        items.push({
          id: `${c.id}#${pos}`, position: pos, section, text: it.text, type: it.type,
          ruleCode: it.type === "temp" ? ruleFor(it.limit) : undefined,
          hint: it.hint || (it.type === "temp" ? undefined : it.limit) || undefined,
          tag: it.tag || (c.tag === "new" ? "new" : undefined),
        });
      }
      out.push({ id: c.id, siteId: siteId as SiteId, name: c.name, area: c.area, when: c.when, due: DUE[c.id], suggested: c.tag === "new", items });
    }
  }
  return out;
}

interface State {
  sites: Site[]; people: Person[]; sessions: Session[]; lists: Checklist[]; rules: Record<string, TempRule>;
  runs: Map<string, Run>; alerts: Alert[]; handover: HandoverItem[]; audit: AuditEntry[];
  devices: (Device & { tokenHash: string })[];
  pairings: { codeHash: string; siteId: SiteId; label: string; createdBy: string; expiresAt: number; usedAt?: number }[];
  rotaSources: { siteId: SiteId; tokenHash: string; createdAt: number; lastImportAt?: number; lastResult?: RotaResult }[];
  weeks: Map<string, WeekStatus>; // "SITE|week"
  shifts: (StoredShift & { id: string; siteId: SiteId; personId: string })[];
  notices: (NoticeRow & { dedupeKey?: string })[];
  pushSubs: PushSub[];
  secrets: Map<string, string>;
  prepItems: PrepItem[]; prepSites: SiteId[];
  prepHandovers: Omit<PrepHandover, "entries" | "createdByName" | "submittedByName">[];
  prepEntries: PrepEntry[];
  teamNotices: TeamNotice[];
  timeOff: TimeOff[];
  certificates: (Certificate & { removedAt?: number; removedBy?: string })[];
  equipment: Equipment[];
  equipmentEvents: EquipmentEvent[];
  tasks: Task[];
  shiftReplies: ShiftReply[];
  gasChecks: Omit<GasCheck, "personName">[];
  cover: { id: string; shiftId: string; siteId: SiteId; personId: string; section: string; note?: string; status: CoverStatus; createdAt: number;
    coveredBy?: string; decidedBy?: string; decidedAt?: number; decisionNote?: string; withdrawnAt?: number; cancelledBy?: string; cancelledAt?: number; cancelNote?: string }[];
  coverOffers: { id: string; requestId: string; personId: string; createdAt: number; withdrawnAt?: number }[];
  libDocs: (Omit<LibraryDoc, "published" | "open"> & { createdBy: string })[];
  libVersions: Omit<LibraryVersion, "authorName" | "reviewedByName" | "approvedByName">[];
  libAcks: Omit<LibraryAck, "docId">[];
  media: Map<string, { mime: string; bytes: Uint8Array; width: number; height: number; createdBy: string; createdAt: number; erasedAt?: number; erasedBy?: string }>;
  trainingSkills: (Skill & { createdBy: string; retiredBy?: string })[];
  trainingQuestions: (Question & { createdBy: string; approvedBy?: string; retiredAt?: number; retiredBy?: string })[];
  trainingPathways: Pathway[];
  trainingStarts: TrainingStart[];
  trainingEvents: (Omit<TrainingEvent, "byName"> & { detail?: unknown })[];
}

const DEMO_FREE = Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, "free" as const]));

/** A sample SOP, prep recipe and dish, published, so the library has something to show in demo mode. */
function demoLibrary(): Pick<State, "libDocs" | "libVersions" | "libAcks" | "media"> {
  const at = Date.now() - 3 * 86_400_000;
  const published = { authorId: "DEMO-MGR", contributors: ["DEMO-MGR"], rev: 3, createdAt: at, updatedAt: at, submittedBy: "DEMO-MGR", submittedAt: at,
    approvedBy: "DEMO-OWN", publishedAt: at, change: "new" as const, reviewBy: addDaysIso(londonDate(at), 365), status: "published" as const, version: 1 };
  return {
    libDocs: [
      { id: "00000000-0000-4000-8000-0000000000a1", kind: "sop", code: "SOP-GEN-001", createdAt: at, createdBy: "DEMO-MGR" },
      { id: "00000000-0000-4000-8000-0000000000a2", kind: "prep", code: "PREP-PROD-001", createdAt: at, createdBy: "DEMO-MGR" },
      { id: "00000000-0000-4000-8000-0000000000a3", kind: "dish", code: "DISH-BOH-001", createdAt: at, createdBy: "DEMO-MGR" },
    ],
    libVersions: [{
      ...published, id: "00000000-0000-4000-8000-0000000000b2", docId: "00000000-0000-4000-8000-0000000000a2", title: "Pho broth (demo)",
      body: { sections: ["PROD"], category: "Broth", makes: { qty: 60, unit: "L" }, ingredients: [
        { qty: 25, unit: "kg", name: "Beef marrow bones" }, { qty: 30, unit: "kg", name: "Beef bones" }, { qty: 3, unit: "kg", name: "Rock sugar" },
        { qty: 900, unit: "g", name: "Coriander seed", note: "toasted" }, { qty: 100, unit: "g", name: "Star anise", note: "toasted" },
        { qty: 600, unit: "g", name: "Ginger", note: "charred" }, { qty: 5, unit: "bottle", name: "Fish sauce", note: "added at the end" },
      ], steps: [
        { text: "Blanch the bones for 10 minutes, drain and rinse." },
        { text: "Cover with fresh water, bring up and simmer for 12 hours, skimming." , warning: "Never let it boil hard: the broth turns cloudy." },
        { text: "Add the toasted spices and charred ginger for the last 2 hours, then season with rock sugar and fish sauce." },
        { text: "Strain, then cool to below 8°C within 90 minutes in the blast chiller." },
      ], storage: "Chilled at 0–5°C in lidded tubs, labelled with the date", shelfLife: { qty: 3, unit: "days" },
      allergens: { ...DEMO_FREE, fish: "contains" }, notes: "" },
    }, {
      ...published, id: "00000000-0000-4000-8000-0000000000b3", docId: "00000000-0000-4000-8000-0000000000a3", title: "Pho beef brisket (demo)",
      body: { sections: ["BOH"], category: "Pho", components: [
        { qty: 330, unit: "g", name: "Rice noodles", note: "blanched" }, { qty: 80, unit: "g", name: "Beef brisket", note: "sliced thin" },
        { qty: 500, unit: "ml", name: "Pho broth", prep: "00000000-0000-4000-8000-0000000000a2" }, { qty: 1, unit: "portion", name: "Herb plate", note: "basil, lime, chilli, bean sprouts" },
      ], steps: [
        { text: "Noodles in a warm bowl, brisket on top." },
        { text: "Ladle the broth over at a rolling boil, so it's piping hot.", warning: "The broth must be at least 75°C." },
        { text: "Serve with the herb plate on the side." },
      ], allergens: { ...DEMO_FREE, fish: "contains" }, modifications: "Fish sauce is in the broth: it can't be left out.", dietary: [] },
    }, {
      id: "00000000-0000-4000-8000-0000000000b1", docId: "00000000-0000-4000-8000-0000000000a1", status: "published", version: 1, title: "Hand washing (demo)",
      body: { sections: [], purpose: "Clean hands stop bacteria and allergens spreading to food. Wash before starting work, after breaks, raw food, bins and cleaning, and after touching your face or phone.", steps: [
        { text: "Wet your hands with warm running water." },
        { text: "Use soap from the dispenser and rub palms, backs, between the fingers, thumbs and fingertips for at least 20 seconds." },
        { text: "Rinse well under running water." },
        { text: "Dry with a clean paper towel, then use the towel to turn off the tap.", warning: "Never dry hands on your apron or a tea towel." },
      ] },
      authorId: "DEMO-MGR", contributors: ["DEMO-MGR"], rev: 3, createdAt: at, updatedAt: at, submittedBy: "DEMO-MGR", submittedAt: at,
      approvedBy: "DEMO-OWN", publishedAt: at, change: "new", reviewBy: addDaysIso(londonDate(at), 365),
    }],
    libAcks: [{ versionId: "00000000-0000-4000-8000-0000000000b1", personId: "DEMO-OWN", at }],
    media: new Map(),
  };
}

/**
 * Sample skills, quizzes and progress so the training screens have something to show in demo mode: a knowledge skill
 * passed, a hands-on one waiting for a manager, and a drafted question waiting for approval.
 */
function demoTraining(): Pick<State, "trainingSkills" | "trainingQuestions" | "trainingPathways" | "trainingStarts" | "trainingEvents"> {
  const at = Date.now() - 10 * 86_400_000;
  const started = londonDate(at);
  const id = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;
  const sk = (n: number, s: Partial<Skill> & Pick<Skill, "section" | "group" | "position" | "title">): State["trainingSkills"][number] =>
    ({ id: id(n), about: "", handsOn: false, induction: false, links: [], passMark: 80, createdAt: at, updatedAt: at, rev: 1, createdBy: "DEMO-OWN", ...s });
  const qn = (skill: number, position: number, text: string, options: string[], answer: number, approved = true): State["trainingQuestions"][number] =>
    ({ id: `00000000-0000-4000-8000-00000000d${skill}${position}0`.slice(0, 36), skillId: id(skill), position, text, options, answer, approved,
      approvedAt: approved ? at : undefined, approvedBy: approved ? "DEMO-OWN" : undefined, createdBy: "DEMO-OWN", createdAt: at, updatedAt: at });
  const SOP = "00000000-0000-4000-8000-0000000000a1", PREP = "00000000-0000-4000-8000-0000000000a2", DISH = "00000000-0000-4000-8000-0000000000a3";
  return {
    trainingSkills: [
      sk(1, { section: "FOH", group: "Operations", position: 1, title: "The 14 allergens (demo)", induction: true, refresherMonths: 12,
        about: "Which allergens the law names, how to use the allergen matrix, and what to do when a guest tells you about an allergy.", links: [DISH] }),
      sk(2, { section: "FOH", group: "Hygiene & Cleaning", position: 2, title: "Hand washing (demo)", induction: true, links: [SOP] }),
      sk(3, { section: "FOH", group: "Service", position: 3, title: "Taking an order on the handheld (demo)", handsOn: true }),
      sk(4, { section: "BOH", group: "Operations", position: 1, title: "Temperature checks (demo)", induction: true, refresherMonths: 12,
        about: "Fridge, freezer and cooking temperatures: when to check, what's in range, and what to do if it isn't." }),
      sk(5, { section: "BOH", group: "Service", position: 2, title: "Pho station (demo)", handsOn: true, links: [DISH, PREP],
        about: "Building every pho on the menu to spec, at speed, with the broth at a rolling boil." }),
      sk(6, { section: "PROD", group: "Production", position: 1, title: "Cooling broth (demo)", links: [PREP], about: "Getting cooked broth below 8°C safely and on time." }),
    ],
    trainingQuestions: [
      qn(1, 1, "How many allergens must UK food businesses tell guests about?", ["8", "12", "14", "20"], 2),
      qn(1, 2, "A guest says they're allergic to peanuts. What do you do first?", ["Tell the kitchen and check the allergen matrix", "Suggest a dish that looks safe", "Ask them to choose something plain"], 0),
      qn(1, 3, "Which of these is one of the 14 allergens?", ["Garlic", "Sesame", "Chilli"], 1),
      qn(2, 1, "How long do you rub your hands with soap?", ["5 seconds", "At least 20 seconds", "2 minutes"], 1),
      qn(2, 2, "What do you dry your hands with?", ["Your apron", "A tea towel", "A clean paper towel"], 2),
      qn(4, 1, "Fridges should run at:", ["0–5°C", "8–10°C", "Room temperature"], 0),
      qn(4, 2, "When are the fridge temperatures recorded?", ["In the opening and closing checks", "Once a week", "Only when it looks warm"], 0, false),
      qn(5, 1, "How hot must the broth be when it's poured?", ["At a rolling boil", "Just warm", "Room temperature"], 0),
      qn(5, 2, "What goes in the bowl first?", ["The broth", "The noodles", "The herbs"], 1),
      qn(6, 1, "Cooked broth is cooled to below 8°C within:", ["90 minutes", "4 hours", "Overnight"], 0),
    ],
    trainingPathways: [{ section: "FOH", inductionDays: 7, allDays: 42 }, { section: "BOH", inductionDays: 7, allDays: 42 }, { section: "PROD", inductionDays: 7, allDays: 42 }],
    trainingStarts: [
      { personId: "DEMO-FOH", section: "FOH", startedOn: started }, { personId: "DEMO-BOH", section: "BOH", startedOn: started },
      { personId: "DEMO-MGR", section: "FOH", startedOn: started }, { personId: "DEMO-MGR", section: "BOH", startedOn: started },
      { personId: "DEMO-PRD", section: "PROD", startedOn: started }, { personId: "DEMO-FLT", section: "BOH", startedOn: started }, { personId: "DEMO-FLT", section: "PROD", startedOn: started },
    ],
    trainingEvents: [
      { id: "00000000-0000-4000-8000-0000000000e1", personId: "DEMO-FOH", skillId: id(2), kind: "quiz", at: at + 86_400_000, byId: "DEMO-FOH", score: 100, passed: true },
      { id: "00000000-0000-4000-8000-0000000000e2", personId: "DEMO-BOH", skillId: id(5), kind: "quiz", at: at + 2 * 86_400_000, byId: "DEMO-BOH", score: 100, passed: true },
    ],
  };
}

/** Sample records so the certificates screens have something to show in demo mode. */
function demoCertificates(): Certificate[] {
  const today = londonDate(Date.now());
  const d = (n: number) => addDaysIso(today, n);
  let i = 0;
  const c = (personId: string, kind: Certificate["kind"], issued: number, expires?: number, provider?: string): Certificate =>
    ({ id: `demo-cert-${++i}`, personId, kind, issuedOn: d(issued), expiresOn: expires === undefined ? undefined : d(expires), provider, createdBy: "DEMO-OWN", createdAt: Date.now() - 86_400_000 + i });
  return [
    c("DEMO-FOH", "food_hygiene_l2", -400, 695, "Highfield e-learning"), c("DEMO-FOH", "allergen", -1080, 15, "Food Standards Agency"),
    c("DEMO-BOH", "food_hygiene_l2", -1100, -5, "Highfield e-learning"), c("DEMO-BOH", "allergen", -200, 895, "Food Standards Agency"), c("DEMO-BOH", "first_aid", -300, 795, "St John Ambulance"),
    c("DEMO-MGR", "food_hygiene_l2", -500, 595), c("DEMO-MGR", "food_hygiene_l3", -500, 595, "CIEH"), c("DEMO-MGR", "allergen", -100, 995), c("DEMO-MGR", "fire_marshal", -60, 1035), c("DEMO-MGR", "right_to_work", -700),
    c("DEMO-PRD", "food_hygiene_l2", -90, 1005), c("DEMO-PRD", "right_to_work", -340, 20),
  ];
}

/** Sample kit for demo mode: a fridge with a fault, a fryer that's had its service. */
function demoEquipment(): { equipment: Equipment[]; equipmentEvents: EquipmentEvent[] } {
  const now = Date.now();
  const today = londonDate(now);
  const eq = (id: string, siteId: SiteId, name: string, kind: Equipment["kind"], location: string, serviceEveryMonths?: number, serviceContact?: string): Equipment =>
    ({ id, siteId, name, kind, location, serviceEveryMonths, serviceContact, createdAt: now - 30 * 86_400_000 });
  return {
    equipment: [
      eq("demo-eq-1", "EAS", "Walk-in fridge", "fridge", "Kitchen, back wall", 6, "Cold Co Refrigeration (demo)"),
      eq("demo-eq-2", "EAS", "Fryer 2", "cooking", "Kitchen, hot line", 12, "Fry Fix Ltd (demo)"),
      eq("demo-eq-3", "EAS", "Glasswasher", "dishwasher", "Bar"),
      eq("demo-eq-4", "EAS", "Probe thermometer", "probe", "Pass"),
      eq("demo-eq-5", "WEM", "Blast chiller", "fridge", "Production room", 6, "Cold Co Refrigeration (demo)"),
    ],
    equipmentEvents: [
      { id: "demo-ev-1", equipmentId: "demo-eq-2", siteId: "EAS", kind: "service", body: "Annual service. Thermostat checked", doneOn: addDaysIso(today, -355), createdBy: "DEMO-MGR", createdAt: now - 355 * 86_400_000 },
      { id: "demo-ev-2", equipmentId: "demo-eq-1", siteId: "EAS", kind: "service", body: "Gaskets replaced", doneOn: addDaysIso(today, -100), createdBy: "DEMO-MGR", createdAt: now - 100 * 86_400_000 },
      { id: "demo-ev-3", equipmentId: "demo-eq-3", siteId: "EAS", kind: "fault", severity: "attention", body: "Leaking a little from the door", createdBy: "DEMO-FOH", createdAt: now - 26 * 3_600_000 },
    ],
  };
}

/** Sample tasks for demo mode. */
function demoTasks(): Task[] {
  const now = Date.now();
  const today = londonDate(now);
  const t = (id: string, title: string, priority: Task["priority"], category: Task["category"], over: Partial<Task> = {}): Task =>
    ({ id, siteId: "EAS", title, priority, category, status: "open", createdBy: "DEMO-MGR", createdByName: "", createdAt: now - 3_600_000, ...over });
  return [
    t("demo-task-1", "Deep clean the extraction hood filters", 3, "cleaning", { section: "BOH", dueOn: addDaysIso(today, 3) }),
    t("demo-task-2", "Order more takeaway boxes", 2, "stock", { assigneeId: "DEMO-FOH", dueOn: addDaysIso(today, 1) }),
    t("demo-task-3", "Update the allergen matrix for the new lunch menu", 2, "food_safety", { dueOn: addDaysIso(today, 2) }),
  ];
}

function seed(): State {
  const owner = hashPin(DEMO_PINS.owner), staff = hashPin(DEMO_PINS.staff);
  const p = (id: string, name: string, access: Person["access"], pin: string): Person =>
    ({ id, staffCode: id, name, status: "active", pinFailed: 0, pinHash: pin, access });
  return {
    sites: [
      { id: "EAS", name: "Eastcote", kind: "restaurant", status: "open", readyBy: "12:00" },
      { id: "WEM", name: "Wembley", kind: "production", status: "open", readyBy: "08:00" },
      { id: "SYD", name: "Sydenham", kind: "restaurant", status: "closed", closedReason: "Closed until it reopens" },
    ],
    people: [
      { ...p("DEMO-OWN", "Owner (demo)", [{ siteId: "EAS", role: "owner", sections: ["FOH", "BOH"] }, { siteId: "WEM", role: "owner", sections: ["PROD"] }, { siteId: "SYD", role: "owner", sections: [] }], owner), seesRightToWork: true },
      p("DEMO-FOH", "FOH staff (demo)", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }], staff),
      p("DEMO-BOH", "BOH staff (demo)", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }], staff),
      p("DEMO-MGR", "Manager (demo)", [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }], staff),
      p("DEMO-OPS", "Ops manager (demo)", [{ siteId: "EAS", role: "ops", sections: [] }, { siteId: "WEM", role: "ops", sections: [] }], staff),
      p("DEMO-PRD", "Wembley cook (demo)", [{ siteId: "WEM", role: "staff", sections: ["PROD"] }], staff),
      p("DEMO-FLT", "Floater (demo)", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }], staff),
    ],
    sessions: [],
    lists: buildChecklists(),
    // Placeholder limits until the owner confirms them against the approved HACCP plan.
    rules: {
      F: { code: "F", label: "Fridge / chilled", targetMax: 5, legalMax: 8 },
      Z: { code: "Z", label: "Freezer", targetMax: -18 },
      C: { code: "C", label: "Cooking core", targetMin: 75, legalMin: 75 },
    },
    runs: new Map(), alerts: [], handover: [], audit: [], devices: [], pairings: [],
    rotaSources: [], weeks: new Map(), shifts: [], notices: [], pushSubs: [], secrets: new Map(),
    prepItems: masterItems(), prepSites: ["EAS"], prepHandovers: [], prepEntries: [], teamNotices: [], timeOff: [], certificates: demoCertificates(), ...demoEquipment(), tasks: demoTasks(), shiftReplies: [], gasChecks: [], cover: [], coverOffers: [], ...demoLibrary(), ...demoTraining(),
  };
}

/** Never hand the token hash out of the store. */
const publicDevice = (d: Device & { tokenHash: string }): Device =>
  ({ id: d.id, siteId: d.siteId, label: d.label, status: d.status, lastSeen: d.lastSeen, createdAt: d.createdAt });

const nameOf = (id?: string) => (id ? S().people.find((p) => p.id === id)?.name ?? "" : undefined);
const prepView = (e: PrepEntry): PrepEntryView => ({ ...e, createdByName: nameOf(e.createdBy) ?? "", completedByName: nameOf(e.completedBy) });
function prepFull(id: string): PrepHandover | undefined {
  const h = S().prepHandovers.find((x) => x.id === id);
  if (!h) return undefined;
  return { ...h, createdByName: nameOf(h.createdBy) ?? "", submittedByName: nameOf(h.submittedBy), entries: S().prepEntries.filter((e) => e.handoverId === id).map(prepView) };
}
const prepOpen = (siteId: SiteId) => S().prepEntries.filter((e) => e.siteId === siteId && e.status === "outstanding"
  && S().prepHandovers.find((h) => h.id === e.handoverId)?.status === "submitted");

const certView = (c: State["certificates"][number]): Certificate => ({
  id: c.id, personId: c.personId, kind: c.kind, issuedOn: c.issuedOn, expiresOn: c.expiresOn, provider: c.provider, reference: c.reference,
  note: c.note, createdBy: c.createdBy, createdByName: nameOf(c.createdBy) ?? "", createdAt: c.createdAt,
});

function coverView(c: State["cover"][number]): CoverRequest | undefined {
  const sh = S().shifts.find((s) => s.id === c.shiftId);
  if (!sh) return undefined;
  return {
    id: c.id, shiftId: c.shiftId, siteId: c.siteId, siteName: S().sites.find((s) => s.id === c.siteId)?.name ?? c.siteId, personId: c.personId,
    personName: nameOf(c.personId) ?? "", section: c.section, note: c.note, status: c.status, createdAt: c.createdAt,
    coveredBy: c.coveredBy, coveredByName: nameOf(c.coveredBy), decidedBy: c.decidedBy, decidedByName: nameOf(c.decidedBy), decidedAt: c.decidedAt, decisionNote: c.decisionNote,
    cancelledByName: nameOf(c.cancelledBy), cancelledAt: c.cancelledAt, cancelNote: c.cancelNote,
    date: sh.date, start: sh.start, end: sh.end, shiftCancelled: sh.cancelled, shiftPersonId: sh.personId,
    covererOnRota: !!c.coveredBy && S().shifts.some((x) => x.personId === c.coveredBy && x.siteId === c.siteId && !x.cancelled
      && shiftStart(x) < shiftEnd(sh) && shiftStart(sh) < shiftEnd(x)),
    offers: S().coverOffers.filter((o) => o.requestId === c.id).sort((a, b) => a.createdAt - b.createdAt)
      .map((o) => ({ id: o.id, personId: o.personId, personName: nameOf(o.personId) ?? "", createdAt: o.createdAt, withdrawnAt: o.withdrawnAt })),
  };
}

const taskView = (t: Task): Task => ({ ...t, createdByName: nameOf(t.createdBy) ?? "", assigneeName: nameOf(t.assigneeId), doneByName: nameOf(t.doneBy) });
const libVersionView = (v: State["libVersions"][number], light = false): LibraryVersion => {
  const copy = structuredClone(v);
  // Light: who it's for and its category only, the rest empty (like the SQL store).
  if (light) copy.body = { sections: copy.body.sections, category: "category" in copy.body ? copy.body.category : "", purpose: "", steps: [], ingredients: [], components: [],
    allergens: {}, dietary: [] } as unknown as LibraryVersion["body"];
  return { ...copy, authorName: nameOf(v.authorId) ?? "", reviewedByName: nameOf(v.reviewedBy), approvedByName: nameOf(v.approvedBy) };
};
function libDocView(d: State["libDocs"][number], light = false): LibraryDoc {
  const versions = S().libVersions.filter((v) => v.docId === d.id);
  const published = versions.find((v) => v.status === "published");
  const open = versions.find((v) => v.status === "draft" || v.status === "in_review");
  return { id: d.id, kind: d.kind, code: d.code, createdAt: d.createdAt, retiredAt: d.retiredAt, retiredBy: d.retiredBy, retiredNote: d.retiredNote,
    published: published && libVersionView(published, light), open: open && libVersionView(open, light) };
}

/**
 * Makes a change to people, their access or a site, then starts training today in each section someone trains in now
 * that they didn't before (the rule is trainingSections): given a new section, back from leaving or a freeze, or their
 * site reopened.
 */
function withStarts(personIds: string[], change: () => void) {
  const now = (id: string) => { const p = S().people.find((x) => x.id === id); return p ? trainingSections(p, S().sites) : []; };
  const before = new Map(personIds.map((id) => [id, now(id)]));
  change();
  const today = londonDate(Date.now());
  for (const id of personIds) {
    for (const section of now(id)) {
      if (before.get(id)!.includes(section) || S().trainingStarts.some((s) => s.personId === id && s.section === section && s.startedOn === today)) continue;
      S().trainingStarts.push({ personId: id, section, startedOn: today });
    }
  }
}
const questionView = (q: State["trainingQuestions"][number]): Question => ({
  id: q.id, skillId: q.skillId, position: q.position, text: q.text, options: [...q.options], answer: q.answer, approved: q.approved,
  approvedAt: q.approvedAt, createdAt: q.createdAt, updatedAt: q.updatedAt,
});
const skillView = (k: State["trainingSkills"][number]): Skill => ({
  id: k.id, section: k.section, group: k.group, position: k.position, title: k.title, about: k.about, handsOn: k.handsOn, induction: k.induction,
  links: [...k.links], videoUrl: k.videoUrl, refresherMonths: k.refresherMonths, passMark: k.passMark, createdAt: k.createdAt, updatedAt: k.updatedAt,
  rulesChangedAt: k.rulesChangedAt, rev: k.rev, retiredAt: k.retiredAt,
});
const lastPosition = (section: Skill["section"], liveOnly = false) =>
  Math.max(0, ...S().trainingSkills.filter((k) => k.section === section && (!liveOnly || !k.retiredAt)).map((k) => k.position));

const g = globalThis as unknown as { __phocoDemo?: State };
const S = (): State => (g.__phocoDemo ??= seed());

export function resetDemo() { g.__phocoDemo = seed(); }

export const demoStore: Store = {
  async sites() { return S().sites; },
  async site(id) { return S().sites.find((s) => s.id === id); },
  async setSiteStatus(id, status, reason) {
    const s = S().sites.find((x) => x.id === id);
    if (!s) return;
    withStarts(S().people.filter((p) => p.access.some((a) => a.siteId === id)).map((p) => p.id), () => {
      s.status = status; s.closedReason = status === "closed" ? reason : undefined;
    });
  },

  async people() { return S().people; },
  async person(id) { return S().people.find((p) => p.id === id); },
  async updatePerson(id, patch) { const p = S().people.find((x) => x.id === id); if (p) withStarts([id], () => Object.assign(p, patch)); },
  async createPerson({ staffCode, name, pinHash, pinMustChange, access }) {
    const id = randomUUID();
    S().people.push({ id, staffCode, name, status: "active", pinHash, pinMustChange, pinFailed: 0, access: [] });
    withStarts([id], () => { S().people.find((x) => x.id === id)!.access = access; });
    return id;
  },
  async setAccess(personId, access) {
    const p = S().people.find((x) => x.id === personId);
    if (p) withStarts([personId], () => { p.access = access; });
  },

  async createSession(personId, siteId, ttlMs, deviceId, scope = "full") {
    const s: Session = { id: randomUUID(), personId, siteId, deviceId, scope, startedAt: Date.now(), expiresAt: Date.now() + ttlMs };
    S().sessions.push(s);
    return s;
  },
  async session(id) { return S().sessions.find((s) => s.id === id); },
  async revokeSessions(match, reason) {
    let n = 0;
    for (const s of S().sessions) {
      if (s.revokedAt) continue;
      if (match.personId && s.personId !== match.personId) continue;
      if (match.siteId && s.siteId !== match.siteId) continue;
      if (match.deviceId && s.deviceId !== match.deviceId) continue;
      if (match.exceptPersonIds?.includes(s.personId)) continue;
      if (match.exceptSessionId === s.id) continue;
      s.revokedAt = Date.now(); s.revokedReason = reason; n++;
    }
    return n;
  },

  async devices() { return S().devices.map(publicDevice); },
  async deviceByToken(tokenHash) {
    const d = S().devices.find((x) => x.tokenHash === tokenHash);
    if (!d) return undefined;
    d.lastSeen = Date.now();
    return publicDevice(d);
  },
  async device(id) { const d = S().devices.find((x) => x.id === id); return d ? publicDevice(d) : undefined; },
  async setDeviceStatus(id, status) { const d = S().devices.find((x) => x.id === id); if (d) d.status = status; },
  async createPairing(p) { S().pairings.push({ ...p }); },
  async redeemPairing(codeHash, tokenHash, now) {
    const p = S().pairings.find((x) => x.codeHash === codeHash && !x.usedAt && x.expiresAt > now);
    if (!p) return undefined;
    p.usedAt = now;
    const d = { id: randomUUID(), siteId: p.siteId, label: p.label, status: "active" as const, createdAt: now, lastSeen: now, tokenHash };
    S().devices.push(d);
    return publicDevice(d);
  },

  async rules() { return S().rules; },
  async checklists(siteId) { return S().lists.filter((l) => l.siteId === siteId); },
  async checklist(id) { return S().lists.find((l) => l.id === id); },
  async run(listId, date) {
    const k = `${date}|${listId}`;
    let r = S().runs.get(k);
    if (!r) { r = { listId, date, answers: [] }; S().runs.set(k, r); }
    return r;
  },
  async addAnswer(listId, date, answer) { (await this.run(listId, date)).answers.push(answer); },
  async signRun(listId, date, personId) { const r = await this.run(listId, date); r.signedBy = personId; r.signedAt = Date.now(); },

  async alerts(siteId) { return S().alerts.filter((a) => !siteId || a.siteId === siteId); },
  async raiseAlert(a) {
    if (S().alerts.some((x) => x.dedupeKey === a.dedupeKey && !x.resolvedAt)) return;
    S().alerts.unshift({ ...a, id: randomUUID(), createdAt: Date.now() });
  },
  async resolveAlert(id, personId, note) {
    const a = S().alerts.find((x) => x.id === id);
    if (a && !a.resolvedAt) { a.resolvedAt = Date.now(); a.resolvedBy = personId; a.resolutionNote = note; }
  },

  async recordsData(siteId, from, to) {
    const lists = S().lists.filter((l) => l.siteId === siteId);
    const runs = Array.from(S().runs.values()).filter((r) => lists.some((l) => l.id === r.listId));
    const inRange = runs.filter((r) => r.date >= from && r.date <= to);
    const answers = inRange.flatMap((r) => {
      const list = lists.find((l) => l.id === r.listId)!;
      return r.answers.map((a) => {
        const item = list.items.find((i) => i.id === a.itemId);
        return { listId: list.id, listName: list.name, date: r.date, itemId: a.itemId, itemText: item?.text ?? a.itemId, itemType: item?.type ?? "tick",
          ruleCode: item?.ruleCode, value: a.value, outcome: a.outcome, byName: nameOf(a.recordedBy) ?? "", at: a.capturedAt,
          action: a.action, actionByName: a.action ? nameOf(a.recordedBy) : undefined };
      });
    }).sort((a, b) => a.at - b.at);
    const start = londonToUtc(from, "00:00"), end = londonToUtc(addDaysIso(to, 1), "00:00");
    return {
      lists: lists.map((l) => ({ id: l.id, name: l.name, area: l.area, due: l.due })),
      runs: inRange.map((r) => {
        const list = lists.find((l) => l.id === r.listId)!;
        const latest = latestAnswers(r.answers);
        return { listId: r.listId, date: r.date, signedAt: r.signedAt, signedByName: nameOf(r.signedBy), total: list.items.length,
          answered: list.items.filter((i) => { const a = latest.get(i.id); return a && a.outcome !== "todo"; }).length };
      }),
      answers,
      alerts: S().alerts.filter((a) => a.siteId === siteId && a.createdAt >= start && a.createdAt < end).map((a) => ({ ...a, resolvedByName: nameOf(a.resolvedBy) })),
      trackingFrom: runs.map((r) => r.date).sort()[0],
    };
  },

  async handover(siteId, createdSince = Date.now() - 7 * 86_400_000) {
    return S().handover.filter((h) => h.siteId === siteId && (!h.closedAt || h.createdAt >= createdSince))
      .map((h) => ({ ...h, closedByName: h.closedBy ? nameOf(h.closedBy) : undefined }));
  },
  async addHandover(h) { S().handover.unshift({ ...h, createdByName: S().people.find((p) => p.id === h.createdBy)?.name ?? "", id: randomUUID(), createdAt: Date.now() }); },
  async closeHandover(id, siteId, personId) {
    const h = S().handover.find((x) => x.id === id && x.siteId === siteId && !x.closedAt);
    if (!h) return false;
    h.closedAt = Date.now(); h.closedBy = personId; return true;
  },
  async reopenHandover(id, siteId) {
    const h = S().handover.find((x) => x.id === id && x.siteId === siteId && x.closedAt);
    if (!h) return false;
    h.closedAt = undefined; h.closedBy = undefined; return true;
  },

  async prepItems() { return S().prepItems; },
  async prepEnabledSites() { return S().prepSites; },
  async prepDraft(siteId) { const h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft"); return h ? prepFull(h.id) : undefined; },
  async prepEditDraft(siteId, personId, change) {
    let h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft");
    const now = Date.now();
    if (!h) { h = { id: randomUUID(), siteId, shift: change.shift ?? "next", status: "draft", createdBy: personId, createdAt: now, updatedAt: now }; S().prepHandovers.push(h); }
    if (change.shift) h.shift = change.shift;
    h.updatedAt = now;
    if (!change.itemId) return;
    const i = S().prepEntries.findIndex((e) => e.handoverId === h!.id && e.itemId === change.itemId);
    if (change.needed === false) { if (i >= 0) S().prepEntries.splice(i, 1); return; }
    let e = i >= 0 ? S().prepEntries[i] : undefined;
    if (!e) { e = { id: randomUUID(), handoverId: h.id, siteId, itemId: change.itemId, status: "outstanding", urgent: false, createdBy: personId, createdAt: now }; S().prepEntries.push(e); }
    if (change.urgent !== undefined) e.urgent = change.urgent;
    if (change.note !== undefined) e.note = change.note || undefined;
  },
  async prepOutstanding(siteId) { return prepOpen(siteId).map(prepView); },
  async prepSubmit(siteId, personId, makePlan) {
    const h = S().prepHandovers.find((x) => x.siteId === siteId && x.status === "draft");
    if (!h) return undefined;
    const draft = S().prepEntries.filter((e) => e.handoverId === h.id);
    const plan = makePlan(draft, prepOpen(siteId), S().prepItems.filter((i) => i.active).map((i) => i.id));
    const now = Date.now();
    for (const c of plan.carryIn) S().prepEntries.push({ id: randomUUID(), handoverId: h.id, siteId, itemId: c.itemId, status: "outstanding", urgent: c.urgent, note: c.note, carriedFrom: c.from, createdBy: personId, createdAt: now });
    for (const m of plan.merge) { const e = S().prepEntries.find((x) => x.id === m.entryId); if (e) { e.carriedFrom = m.from; e.urgent = m.urgent; e.note = m.note; } }
    for (const id of plan.markCarried) { const e = S().prepEntries.find((x) => x.id === id); if (e) e.status = "carried"; }
    Object.assign(h, { status: "submitted", submittedBy: personId, submittedAt: now, updatedAt: now, stockedCount: plan.stockedCount });
    return { handoverId: h.id, plan };
  },
  async prepHandover(id) { return prepFull(id); },
  async prepHandovers(siteId, limit) {
    return S().prepHandovers.filter((h) => h.siteId === siteId && h.status === "submitted")
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)).slice(0, limit).map((h) => prepFull(h.id)!);
  },
  async prepSetDone(entryId, siteId, personId, done) {
    const e = S().prepEntries.find((x) => x.id === entryId && x.siteId === siteId && x.status === (done ? "outstanding" : "completed"));
    if (!e || S().prepHandovers.find((h) => h.id === e.handoverId)?.status !== "submitted") return false;
    if (done) { e.status = "completed"; e.completedBy = personId; e.completedAt = Date.now(); }
    else { e.status = "outstanding"; e.completedBy = undefined; e.completedAt = undefined; }
    return true;
  },

  async teamNotices(recentEnded = 10) {
    const today = londonDate(Date.now());
    const all = [...S().teamNotices].sort((a, b) => b.createdAt - a.createdAt);
    const live = (n: TeamNotice) => !n.endedAt && (!n.showUntil || n.showUntil >= today);
    return [...all.filter(live), ...all.filter((n) => !live(n)).slice(0, recentEnded)]
      .map((n) => ({ ...n, createdByName: nameOf(n.createdBy) ?? "", reads: [...n.reads] }));
  },
  async addTeamNotice(n) {
    const id = randomUUID();
    S().teamNotices.push({ ...n, id, createdAt: Date.now(), createdByName: "", reads: [] });
    return id;
  },
  async endTeamNotice(id) {
    const n = S().teamNotices.find((x) => x.id === id && !x.endedAt);
    if (!n) return false;
    n.endedAt = Date.now(); return true;
  },
  async readTeamNotice(id, personId) {
    const n = S().teamNotices.find((x) => x.id === id);
    if (!n) return false;
    if (!n.reads.some((r) => r.personId === personId)) n.reads.push({ personId, readAt: Date.now() });
    return true;
  },

  async timeOff(f) {
    return S().timeOff.filter((t) => (!f.personId || t.personId === f.personId) && (!f.siteIds || f.siteIds.includes(t.siteId))
      && (!f.from || t.endsOn >= f.from) && (!f.to || t.startsOn <= f.to) && (!f.statuses || f.statuses.includes(t.status)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({ ...t, personName: nameOf(t.personId) ?? "", decidedByName: nameOf(t.decidedBy) }));
  },
  async requestTimeOff(t) {
    const id = randomUUID();
    S().timeOff.push({ ...t, id, personName: "", status: "pending", createdAt: Date.now() });
    return id;
  },
  async decideTimeOff(id, decision, personId, note) {
    const t = S().timeOff.find((x) => x.id === id && x.status === "pending");
    if (!t) return false;
    Object.assign(t, { status: decision, decidedBy: personId, decidedAt: Date.now(), decisionNote: note });
    return true;
  },
  async cancelTimeOff(id, from) {
    const t = S().timeOff.find((x) => x.id === id && x.status === from);
    if (!t) return false;
    t.status = "cancelled"; return true;
  },

  async certificates(f = {}) {
    return S().certificates.filter((c) => !c.removedAt && (!f.personIds || f.personIds.includes(c.personId)))
      .sort((a, b) => a.createdAt - b.createdAt).map(certView);
  },
  async certificate(id) {
    const c = S().certificates.find((x) => x.id === id && !x.removedAt);
    return c && certView(c);
  },
  async addCertificate(c) {
    const id = randomUUID();
    S().certificates.push({ ...c, id, createdAt: Date.now() });
    return id;
  },
  async removeCertificate(id, personId) {
    const c = S().certificates.find((x) => x.id === id && !x.removedAt);
    if (!c) return false;
    c.removedAt = Date.now(); c.removedBy = personId; return true;
  },

  async equipment(siteId, includeRetired = false) {
    return S().equipment.filter((e) => e.siteId === siteId && (includeRetired || !e.retiredAt)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ ...e }));
  },
  async equipmentItem(id) { const e = S().equipment.find((x) => x.id === id); return e && { ...e }; },
  async addEquipment(e) {
    const id = randomUUID();
    S().equipment.push({ id, siteId: e.siteId, name: e.name, kind: e.kind, location: e.location, makeModel: e.makeModel, serial: e.serial,
      serviceEveryMonths: e.serviceEveryMonths, serviceContact: e.serviceContact, instructions: e.instructions, createdAt: Date.now() });
    return id;
  },
  async updateEquipment(id, e) {
    const x = S().equipment.find((y) => y.id === id && !y.retiredAt);
    if (!x) return false;
    Object.assign(x, { name: e.name, kind: e.kind, location: e.location, makeModel: e.makeModel, serial: e.serial, serviceEveryMonths: e.serviceEveryMonths, serviceContact: e.serviceContact, instructions: e.instructions });
    return true;
  },
  async retireEquipment(id) {
    const x = S().equipment.find((y) => y.id === id && !y.retiredAt);
    if (!x) return false;
    x.retiredAt = Date.now(); return true;
  },
  async equipmentEvents(f) {
    const all = S().equipmentEvents;
    const fixed = new Set(all.filter((e) => e.kind === "fixed").map((e) => e.faultId));
    return all.filter((e) => (!f.equipmentId || e.equipmentId === f.equipmentId) && (!f.siteId || e.siteId === f.siteId) && (!f.since || e.createdAt >= f.since)
      && (!f.openFaultsOnly || (e.kind === "fault" && !fixed.has(e.id)) || (e.kind === "update" && !fixed.has(e.faultId))))
      .sort((a, b) => a.createdAt - b.createdAt).map((e) => ({ ...e, createdByName: nameOf(e.createdBy) ?? "" }));
  },
  async addEquipmentEvent(e) {
    if (e.kind === "fixed" && S().equipmentEvents.some((x) => x.kind === "fixed" && x.faultId === e.faultId)) return undefined;
    const id = randomUUID();
    S().equipmentEvents.push({ ...e, id, createdAt: Date.now() });
    return id;
  },

  async tasks(f) {
    return S().tasks.filter((t) => f.siteIds.includes(t.siteId) && (f.statuses ? f.statuses.includes(t.status) : t.status === "open"
      || (f.closedSince !== undefined && ((t.doneAt ?? 0) >= f.closedSince || (t.cancelledAt ?? 0) >= f.closedSince))))
      .sort((a, b) => b.createdAt - a.createdAt).map(taskView);
  },
  async task(id) { const t = S().tasks.find((x) => x.id === id); return t && taskView(t); },
  async addTask(t) {
    const id = randomUUID();
    S().tasks.push({ id, siteId: t.siteId, title: t.title, detail: t.detail, priority: t.priority, category: t.category, assigneeId: t.assigneeId, section: t.section,
      dueOn: t.dueOn, status: "open", createdBy: t.createdBy, createdByName: "", createdAt: Date.now() });
    return id;
  },
  async completeTask(id, personId, note) {
    const t = S().tasks.find((x) => x.id === id && x.status === "open");
    if (!t) return false;
    Object.assign(t, { status: "done", doneBy: personId, doneAt: Date.now(), doneNote: note });
    return true;
  },
  async reopenTask(id, personId) {
    const t = S().tasks.find((x) => x.id === id && x.status === "done" && x.doneBy === personId);
    if (!t) return false;
    Object.assign(t, { status: "open", doneBy: undefined, doneAt: undefined, doneNote: undefined });
    return true;
  },
  async cancelTask(id, personId) {
    const t = S().tasks.find((x) => x.id === id && x.status === "open");
    if (!t) return false;
    Object.assign(t, { status: "cancelled", cancelledBy: personId, cancelledAt: Date.now() });
    return true;
  },

  async rotaSources() { return S().rotaSources.map((r) => ({ siteId: r.siteId, createdAt: r.createdAt, lastImportAt: r.lastImportAt, lastResult: r.lastResult })); },
  async rotaSourceByToken(tokenHash) { return S().rotaSources.find((r) => r.tokenHash === tokenHash)?.siteId; },
  async setRotaToken(siteId, tokenHash) {
    S().rotaSources = [...S().rotaSources.filter((r) => r.siteId !== siteId), { siteId, tokenHash, createdAt: Date.now() }];
  },
  async recordRotaImport(siteId, result) { const r = S().rotaSources.find((x) => x.siteId === siteId); if (r) { r.lastImportAt = Date.now(); r.lastResult = result; } },
  async weekStatuses(siteId) {
    const out = new Map<string, WeekStatus>();
    for (const [k, v] of Array.from(S().weeks.entries())) if (k.startsWith(`${siteId}|`)) out.set(k.slice(4), v);
    return out;
  },
  async setWeekStatuses(siteId, statuses) { for (const [w, st] of Array.from(statuses.entries())) S().weeks.set(`${siteId}|${w}`, st); },
  async siteShifts(siteId) {
    return S().shifts.filter((s) => s.siteId === siteId).map((s): StoredShift => ({ sourceKey: s.sourceKey, staffCode: s.staffCode, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end, endsNextDay: s.endsNextDay, hours: s.hours, cancelled: s.cancelled }));
  },
  async applyShiftSync(siteId, plan, personIdByCode) {
    for (const s of [...plan.added, ...plan.changed.map((c) => c.after)]) {
      const personId = personIdByCode.get(s.staffCode);
      if (!personId) continue;
      const i = S().shifts.findIndex((x) => x.sourceKey === s.sourceKey);
      const row = { ...s, id: i >= 0 ? S().shifts[i].id : randomUUID(), siteId, personId, cancelled: false };
      if (i >= 0) S().shifts[i] = row; else S().shifts.push(row);
    }
    for (const s of plan.cancelled) { const x = S().shifts.find((y) => y.sourceKey === s.sourceKey); if (x) x.cancelled = true; }
  },
  async shiftsForPerson(personId, fromDate, toDate) {
    const names = new Map(S().sites.map((s) => [s.id, s.name]));
    return S().shifts.filter((s) => s.personId === personId && s.date >= fromDate && s.date <= toDate)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map((s): ShiftView => ({ id: s.id, siteId: s.siteId, siteName: names.get(s.siteId) ?? s.siteId, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end,
        published: S().weeks.get(`${s.siteId}|${s.week}`) === "published", cancelled: s.cancelled }));
  },
  async teamShifts(siteId, week) {
    return S().shifts.filter((s) => s.siteId === siteId && s.week === week && !s.cancelled)
      .map((s) => ({ personId: s.personId, name: S().people.find((p) => p.id === s.personId)?.name ?? s.staffCode, section: s.section, date: s.date, start: s.start, end: s.end, hours: s.hours }));
  },
  async shiftsOnDate(date) {
    const names = new Map(S().sites.map((s) => [s.id, s.name]));
    return S().shifts.filter((s) => s.date === date && !s.cancelled && S().weeks.get(`${s.siteId}|${s.week}`) === "published")
      .map((s) => ({ id: s.id, siteId: s.siteId, siteName: names.get(s.siteId) ?? s.siteId, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end,
        published: true, cancelled: false, personId: s.personId, staffCode: s.staffCode }));
  },
  async checklistsStartedOn(siteId) {
    const lists = new Set(S().lists.filter((l) => l.siteId === siteId).map((l) => l.id));
    return Array.from(S().runs.values()).filter((r) => lists.has(r.listId)).map((r) => r.date).sort()[0];
  },
  // ---------- library ----------
  async libraryDocs(kind, opts) {
    return S().libDocs.filter((d) => d.kind === kind).sort((a, b) => a.code.localeCompare(b.code)).map((d) => libDocView(d, !!opts?.light)) as LibraryDoc<BodyOf<typeof kind>>[];
  },
  async libraryDoc(id) {
    const d = S().libDocs.find((x) => x.id === id);
    return d && libDocView(d);
  },
  async libraryVersions(docId) {
    return S().libVersions.filter((v) => v.docId === docId).sort((a, b) => b.createdAt - a.createdAt).map((v) => libVersionView(v));
  },
  async libraryVersion(id) {
    const v = S().libVersions.find((x) => x.id === id);
    return v && libVersionView(v);
  },
  async createLibraryDoc(d) {
    const code = nextCode(d.prefix, S().libDocs.map((x) => x.code));
    const now = Date.now();
    const docId = randomUUID(), versionId = randomUUID();
    S().libDocs.push({ id: docId, kind: d.kind, code, createdAt: now, createdBy: d.authorId });
    S().libVersions.push({ id: versionId, docId, status: "draft", title: d.title, body: structuredClone(d.body), authorId: d.authorId, contributors: [d.authorId], rev: 1, createdAt: now, updatedAt: now });
    return { docId, versionId, code };
  },
  async startLibraryDraft(docId, authorId) {
    const doc = S().libDocs.find((d) => d.id === docId);
    const versions = S().libVersions.filter((v) => v.docId === docId);
    const published = versions.find((v) => v.status === "published");
    if (!doc || doc.retiredAt || !published || versions.some((v) => v.status === "draft" || v.status === "in_review")) return undefined;
    const now = Date.now(), id = randomUUID();
    S().libVersions.push({ id, docId, status: "draft", title: published.title, body: structuredClone(published.body), authorId, contributors: [authorId], rev: 1, createdAt: now, updatedAt: now });
    return id;
  },
  async saveLibraryDraft(versionId, rev, d, personId) {
    const v = S().libVersions.find((x) => x.id === versionId && x.status === "draft" && x.rev === rev);
    if (!v) return undefined;
    Object.assign(v, { title: d.title, body: structuredClone(d.body), updatedAt: Date.now(), rev: v.rev + 1,
      contributors: v.contributors.includes(personId) ? v.contributors : [...v.contributors, personId] });
    return v.rev;
  },
  async moveLibraryVersion(versionId, move, personId, rev, note) {
    const from = move === "submit" || move === "discard" ? "draft" : "in_review";
    const v = S().libVersions.find((x) => x.id === versionId && x.status === from && x.rev === rev);
    if (!v) return false;
    const now = Date.now();
    if (move === "submit") Object.assign(v, { status: "in_review", submittedBy: personId, submittedAt: now, reviewNote: undefined, reviewedBy: undefined, reviewedAt: undefined,
      contributors: v.contributors.includes(personId) ? v.contributors : [...v.contributors, personId] });
    if (move === "withdraw") Object.assign(v, { status: "draft", submittedBy: undefined, submittedAt: undefined });
    if (move === "send_back") Object.assign(v, { status: "draft", submittedBy: undefined, submittedAt: undefined, reviewNote: note, reviewedBy: personId, reviewedAt: now });
    if (move === "discard") {
      v.status = "discarded";
      const doc = S().libDocs.find((x) => x.id === v.docId);
      const everPublished = S().libVersions.some((x) => x.docId === v.docId && x.version !== undefined);
      if (doc && !everPublished && !doc.retiredAt) Object.assign(doc, { retiredAt: now, retiredBy: personId, retiredNote: "Draft discarded before it was published" });
    }
    v.updatedAt = now; v.rev += 1;
    return true;
  },
  async publishLibraryVersion(versionId, rev, p) {
    const v = S().libVersions.find((x) => x.id === versionId && x.status === "in_review" && x.rev === rev);
    const doc = v && S().libDocs.find((d) => d.id === v.docId);
    if (!v || !doc || doc.retiredAt) return undefined;
    if (!p.ownerApproving && (v.authorId === p.approverId || v.submittedBy === p.approverId || v.contributors.includes(p.approverId))) return undefined;
    const now = Date.now();
    const versions = S().libVersions.filter((x) => x.docId === v.docId);
    const prev = versions.find((x) => x.status === "published");
    const allergensChangedAt = p.allergens === "changed" ? now : p.allergens === "same" ? prev?.allergensChangedAt : undefined;
    for (const old of versions.filter((x) => x.status === "published")) Object.assign(old, { status: "superseded", supersededAt: now });
    const n = Math.max(0, ...versions.map((x) => x.version ?? 0)) + 1;
    Object.assign(v, { status: "published", version: n, approvedBy: p.approverId, publishedAt: now, change: p.change, reviewBy: p.reviewBy, updatedAt: now, rev: v.rev + 1, allergensChangedAt });
    if (!S().libAcks.some((a) => a.versionId === v.id && a.personId === p.approverId)) S().libAcks.push({ versionId: v.id, personId: p.approverId, at: now });
    return n;
  },
  async retireLibraryDoc(docId, personId, note) {
    const d = S().libDocs.find((x) => x.id === docId && !x.retiredAt);
    if (!d) return false;
    const now = Date.now();
    Object.assign(d, { retiredAt: now, retiredBy: personId, retiredNote: note });
    for (const v of S().libVersions.filter((x) => x.docId === docId && (x.status === "draft" || x.status === "in_review"))) Object.assign(v, { status: "discarded", updatedAt: now, rev: v.rev + 1 });
    return true;
  },
  async reinstateLibraryDoc(docId) {
    const d = S().libDocs.find((x) => x.id === docId && x.retiredAt);
    if (!d) return false;
    Object.assign(d, { retiredAt: undefined, retiredBy: undefined, retiredNote: undefined });
    return true;
  },
  async libraryAcks(f) {
    const docOf = (versionId: string) => S().libVersions.find((v) => v.id === versionId)?.docId ?? "";
    return S().libAcks.map((a) => ({ ...a, docId: docOf(a.versionId) }))
      .filter((a) => (!f.versionIds || f.versionIds.includes(a.versionId)) && (!f.personId || a.personId === f.personId) && (!f.docId || a.docId === f.docId));
  },
  async ackLibraryVersion(versionId, personId) {
    if (!S().libVersions.some((v) => v.id === versionId && v.status === "published")) return false;
    if (S().libAcks.some((a) => a.versionId === versionId && a.personId === personId)) return false;
    S().libAcks.push({ versionId, personId, at: Date.now() });
    return true;
  },
  async addMedia(m, cap) {
    if (Array.from(S().media.values()).filter((x) => x.createdBy === m.createdBy && x.createdAt >= cap.since).length >= cap.max) return undefined;
    const id = randomUUID();
    S().media.set(id, { mime: "image/jpeg", bytes: new Uint8Array(m.bytes), width: m.width, height: m.height, createdBy: m.createdBy, createdAt: Date.now() });
    return id;
  },
  async media(id) {
    const m = S().media.get(id);
    return m && { mime: m.mime, bytes: m.bytes, erased: !!m.erasedAt };
  },
  async mediaInfo(id) {
    const m = S().media.get(id);
    return m && { mime: m.mime, erased: !!m.erasedAt };
  },
  async mediaStatus(ids) {
    const out = new Map<string, { erased: boolean }>();
    for (const id of ids) { const m = S().media.get(id); if (m) out.set(id, { erased: !!m.erasedAt }); }
    return out;
  },
  async mediaCountSince(personId, since) {
    return Array.from(S().media.values()).filter((m) => m.createdBy === personId && m.createdAt >= since).length;
  },
  async eraseMedia(id, personId) {
    const m = S().media.get(id);
    if (!m || m.erasedAt) return false;
    Object.assign(m, { bytes: new Uint8Array(), erasedAt: Date.now(), erasedBy: personId });
    return true;
  },
  async deleteUnusedMedia(before) {
    const used = JSON.stringify(S().libVersions.filter((v) => v.status !== "discarded").map((v) => v.body));
    let n = 0;
    for (const [id, m] of Array.from(S().media.entries())) if (m.createdAt < before && !used.includes(id)) { S().media.delete(id); n++; }
    return n;
  },

  async trainingSkills() { return S().trainingSkills.map(skillView).sort(bySkillOrder); },
  async trainingSkill(id) { const k = S().trainingSkills.find((x) => x.id === id); return k && skillView(k); },
  async createTrainingSkill(s, by) {
    const id = randomUUID(), now = Date.now();
    S().trainingSkills.push({ ...structuredClone(s), id, position: lastPosition(s.section) + 1, createdAt: now, updatedAt: now, rev: 1, createdBy: by });
    return id;
  },
  async saveTrainingSkill(id, rev, s) {
    const k = S().trainingSkills.find((x) => x.id === id);
    if (!k || k.rev !== rev || k.retiredAt) return undefined;
    const position = k.section === s.section ? k.position : lastPosition(s.section) + 1;
    const sameLinks = new Set(k.links).size === new Set(s.links).size && s.links.every((l) => k.links.includes(l));
    const rules = k.section !== s.section || k.induction !== s.induction || k.handsOn !== s.handsOn || k.refresherMonths !== s.refresherMonths || !sameLinks;
    Object.assign(k, { group: s.group, title: s.title, about: s.about, handsOn: s.handsOn, induction: s.induction, links: [...s.links], videoUrl: s.videoUrl,
      refresherMonths: s.refresherMonths, passMark: s.passMark, section: s.section, position, updatedAt: Date.now(), rev: k.rev + 1,
      rulesChangedAt: rules ? Date.now() : k.rulesChangedAt });
    return k.rev;
  },
  async moveTrainingSkill(id, dir) {
    const me = S().trainingSkills.find((x) => x.id === id && !x.retiredAt);
    if (!me) return false;
    const live = S().trainingSkills.filter((x) => x.section === me.section && !x.retiredAt && x.id !== me.id);
    const other = dir < 0 ? live.filter((x) => x.position < me.position).sort((a, b) => b.position - a.position)[0]
      : live.filter((x) => x.position > me.position).sort((a, b) => a.position - b.position)[0];
    if (!other) return false;
    [me.position, other.position] = [other.position, me.position];
    return true;
  },
  async retireTrainingSkill(id, by) {
    const k = S().trainingSkills.find((x) => x.id === id && !x.retiredAt);
    if (!k) return false;
    Object.assign(k, { retiredAt: Date.now(), retiredBy: by, rev: k.rev + 1 });
    return true;
  },
  async reinstateTrainingSkill(id) {
    const k = S().trainingSkills.find((x) => x.id === id && x.retiredAt);
    if (!k) return false;
    Object.assign(k, { position: lastPosition(k.section, true) + 1, retiredAt: undefined, retiredBy: undefined, rulesChangedAt: Date.now(), rev: k.rev + 1 });
    return true;
  },
  async trainingQuestions(skillIds) {
    return S().trainingQuestions.filter((q) => !q.retiredAt && (!skillIds || skillIds.includes(q.skillId)))
      .sort((a, b) => a.skillId.localeCompare(b.skillId) || a.position - b.position || a.createdAt - b.createdAt).map(questionView);
  },
  async saveTrainingQuestion(x, by, approve) {
    if (!S().trainingSkills.some((k) => k.id === x.skillId && !k.retiredAt)) return undefined;
    const now = Date.now();
    if (x.id) {
      const q = S().trainingQuestions.find((k) => k.id === x.id && k.skillId === x.skillId && !k.retiredAt);
      if (!q) return undefined;
      Object.assign(q, { text: x.text, options: [...x.options], answer: x.answer, updatedAt: now });
      return q.id;
    }
    const id = randomUUID();
    const position = Math.max(0, ...S().trainingQuestions.filter((k) => k.skillId === x.skillId).map((k) => k.position)) + 1;
    S().trainingQuestions.push({ id, skillId: x.skillId, position, text: x.text, options: [...x.options], answer: x.answer, approved: approve,
      approvedAt: approve ? now : undefined, approvedBy: approve ? by : undefined, createdBy: by, createdAt: now, updatedAt: now });
    return id;
  },
  async approveTrainingQuestions(skillId, by) {
    let n = 0;
    for (const q of S().trainingQuestions) {
      if (q.skillId === skillId && !q.approved && !q.retiredAt) { Object.assign(q, { approved: true, approvedAt: Date.now(), approvedBy: by }); n++; }
    }
    return n;
  },
  async retireTrainingQuestion(id, by) {
    const q = S().trainingQuestions.find((x) => x.id === id && !x.retiredAt);
    if (!q) return false;
    Object.assign(q, { retiredAt: Date.now(), retiredBy: by });
    return true;
  },
  async trainingPathways() { return S().trainingPathways.map((p) => ({ ...p })); },
  async saveTrainingPathway(p) {
    const x = S().trainingPathways.find((y) => y.section === p.section);
    if (x) Object.assign(x, p); else S().trainingPathways.push({ ...p });
  },
  async trainingStarts(personIds) {
    // The latest start in each section counts.
    const latest = new Map<string, TrainingStart>();
    for (const s of S().trainingStarts) {
      if (personIds && !personIds.includes(s.personId)) continue;
      const k = `${s.personId}|${s.section}`, was = latest.get(k);
      if (!was || s.startedOn > was.startedOn) latest.set(k, { ...s });
    }
    return Array.from(latest.values());
  },
  async trainingEvents(f) {
    return S().trainingEvents.filter((e) => (!f.personIds || f.personIds.includes(e.personId)) && (!f.skillIds || f.skillIds.includes(e.skillId)))
      .sort((a, b) => a.at - b.at)
      .map((e) => ({ id: e.id, personId: e.personId, skillId: e.skillId, kind: e.kind, at: e.at, byId: e.byId, byName: nameOf(e.byId) ?? "", score: e.score, passed: e.passed, note: e.note }));
  },
  async addTrainingEvent(e) {
    const id = randomUUID();
    S().trainingEvents.push({ id, personId: e.personId, skillId: e.skillId, kind: e.kind, at: Date.now(), byId: e.byId, score: e.score, passed: e.passed, detail: e.detail, note: e.note });
    return id;
  },
  async libraryMajorChanges(docIds) {
    const out = new Map<string, number>();
    for (const v of S().libVersions) {
      if (docIds.includes(v.docId) && v.change === "major" && (v.status === "published" || v.status === "superseded") && v.publishedAt)
        out.set(v.docId, Math.max(out.get(v.docId) ?? 0, v.publishedAt));
    }
    return out;
  },

  async coverRequests(f) {
    return S().cover.filter((c) => (!f.siteIds || f.siteIds.includes(c.siteId)) && (!f.personId || c.personId === f.personId)
      && (!f.live || c.status === "open" || c.status === "approved")).sort((a, b) => b.createdAt - a.createdAt).map(coverView)
      .filter((x): x is CoverRequest => !!x && (f.shiftEndsAfter === undefined || shiftEnd(x) > f.shiftEndsAfter));
  },
  async coverRequest(id) { const c = S().cover.find((x) => x.id === id); return c ? coverView(c) : undefined; },
  async addCoverRequest(r) {
    if (S().cover.some((c) => c.shiftId === r.shiftId && (c.status === "open" || c.status === "approved"))) return undefined;
    const id = randomUUID();
    S().cover.push({ ...r, id, status: "open", createdAt: Date.now() });
    return id;
  },
  async decideCover(id, d) {
    if (d.status === "cancelled") {
      const a = S().cover.find((x) => x.id === id && x.status === "approved");
      if (!a) return false;
      Object.assign(a, { status: "cancelled", cancelledBy: d.personId, cancelledAt: Date.now(), cancelNote: d.note });
      return true;
    }
    const c = S().cover.find((x) => x.id === id && x.status === "open");
    if (!c) return false;
    if (d.status === "withdrawn") { if (c.personId !== d.personId) return false; Object.assign(c, { status: "withdrawn", withdrawnAt: Date.now() }); return true; }
    if (d.status === "approved" && !S().coverOffers.some((o) => o.requestId === id && o.personId === d.coveredBy && !o.withdrawnAt)) return false;
    Object.assign(c, { status: d.status, coveredBy: d.status === "approved" ? d.coveredBy : undefined, decidedBy: d.personId, decidedAt: Date.now(), decisionNote: d.note });
    return true;
  },
  async addCoverOffer(requestId, personId) {
    if (!S().cover.some((c) => c.id === requestId && c.status === "open")) return undefined;
    if (S().coverOffers.some((o) => o.requestId === requestId && o.personId === personId && !o.withdrawnAt)) return undefined;
    const id = randomUUID();
    S().coverOffers.push({ id, requestId, personId, createdAt: Date.now() });
    return id;
  },
  async withdrawCoverOffer(requestId, personId) {
    if (!S().cover.some((c) => c.id === requestId && c.status === "open")) return undefined;
    const o = S().coverOffers.find((x) => x.requestId === requestId && x.personId === personId && !x.withdrawnAt);
    if (!o) return undefined;
    o.withdrawnAt = Date.now();
    return o.id;
  },
  async gasChecks(siteIds, from, to) {
    return S().gasChecks.filter((g) => siteIds.includes(g.siteId) && g.date >= from && g.date <= to)
      .map((g) => ({ ...g, personName: nameOf(g.personId) ?? "" })).sort((a, b) => a.date.localeCompare(b.date));
  },
  async addGasCheck(c) {
    if (S().gasChecks.some((g) => g.siteId === c.siteId && g.date === c.date)) return false;
    S().gasChecks.push({ ...c, createdAt: Date.now() });
    return true;
  },
  async shift(id) {
    const s = S().shifts.find((x) => x.id === id);
    if (!s) return undefined;
    return { id: s.id, siteId: s.siteId, siteName: S().sites.find((x) => x.id === s.siteId)?.name ?? s.siteId, section: s.section, week: s.week, date: s.date, start: s.start, end: s.end,
      published: S().weeks.get(`${s.siteId}|${s.week}`) === "published", cancelled: s.cancelled, personId: s.personId, staffCode: s.staffCode };
  },
  async shiftReplies(shiftIds) { return S().shiftReplies.filter((r) => shiftIds.includes(r.shiftId)).sort((a, b) => a.createdAt - b.createdAt); },
  async addShiftReply(r, isRepeat) {
    const mine = S().shiftReplies.filter((x) => x.shiftId === r.shiftId).sort((a, b) => b.createdAt - a.createdAt);
    const [latest, before] = mine;
    if (latest && isRepeat(latest)) return { reply: { ...latest }, previous: before && { ...before }, added: false };
    // Strictly increasing times, so "latest" is well defined even within one millisecond.
    const last = S().shiftReplies.reduce((m, x) => Math.max(m, x.createdAt), 0);
    const reply = { ...r, id: randomUUID(), createdAt: Math.max(Date.now(), last + 1) };
    S().shiftReplies.push(reply);
    return { reply: { ...reply }, previous: latest && { ...latest }, added: true };
  },
  async noticeKeys(keys) {
    return new Map(S().notices.filter((n) => n.dedupeKey && keys.includes(n.dedupeKey)).map((n) => [n.dedupeKey!, n.createdAt]));
  },
  async peopleWithPush() { return new Set(S().pushSubs.map((p) => p.personId)); },
  async queueNotice(n) {
    if (n.dedupeKey && S().notices.some((x) => x.dedupeKey === n.dedupeKey)) return false;
    S().notices.push({ id: randomUUID(), personId: n.personId, kind: n.kind, title: n.title, body: n.body, dedupeKey: n.dedupeKey, sendAfter: n.sendAfter, createdAt: Date.now(), url: n.url });
    return true;
  },
  async dueNotices(now, limit, personIds) {
    const due = S().notices.filter((n) => !n.sentAt && n.sendAfter <= now && (!personIds || personIds.includes(n.personId))).slice(0, limit);
    for (const n of due) n.sentAt = Date.now();
    return due.map((n) => ({ ...n }));
  },
  async notices(personId, limit) {
    return S().notices.filter((n) => n.personId === personId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
  async savePushSub(sub) { S().pushSubs = [...S().pushSubs.filter((p) => p.endpoint !== sub.endpoint), sub]; },
  async pushSubs(personId) { return S().pushSubs.filter((p) => p.personId === personId); },
  async dropPushSub(endpoint) { S().pushSubs = S().pushSubs.filter((p) => p.endpoint !== endpoint); },
  async secret(key, make) { if (!S().secrets.has(key)) S().secrets.set(key, make()); return S().secrets.get(key)!; },

  async audit(entry) { S().audit.unshift({ ...entry, at: Date.now() }); },
  async auditLog(limit) { return S().audit.slice(0, limit); },
};
