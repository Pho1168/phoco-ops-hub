import { describe, expect, it } from "vitest";
import { canFreeze, canManage, canSignIn, canSwitchTo, isLead, isOps, isOwner, leadSites, managedSites, opsSites, planSiteClosure, remoteSignIn, runsSite } from "./access";
import { activityFor } from "./activity";
import { canEditCerts, certReminderMessages, expectedKinds } from "./certificates";
import { canPostTo } from "./notices";
import { notReadyMessages, readyToOpen } from "./daily";
import { sessionDeviceOk } from "./devices";
import { replyMessages } from "./reminders";
import { accountsFor, canGiveAccess, canManageAccount, canMarkLeft, canRejoin, canUnfreeze, givableRoles, validatePersonInput } from "./staff";
import { londonToUtc } from "./time";
import { canDecide, seesRequest, timeOffDeciders, type TimeOff } from "./timeoff";
import type { Person, Site, SiteAccess } from "./types";

const person = (id: string, access: SiteAccess[], over: Partial<Person> = {}): Person =>
  ({ id, staffCode: id, name: id, status: "active", pinFailed: 0, access, ...over });
const site = (id: Site["id"], status: Site["status"] = "open", kind: Site["kind"] = "restaurant"): Site => ({ id, name: id, kind, status });
const at = (siteId: SiteAccess["siteId"], role: SiteAccess["role"], sections: SiteAccess["sections"] = []): SiteAccess => ({ siteId, role, sections });

// The owner runs everything; Olu is the operations manager for Eastcote and Wembley; Sydenham has its own people.
const owner = person("own", [at("EAS", "owner"), at("WEM", "owner"), at("SYD", "owner")]);
const ops = person("ops", [at("EAS", "ops"), at("WEM", "ops")]);
const ops2 = person("ops2", [at("SYD", "ops")]);
const mgr = person("mgr", [at("EAS", "manager", ["FOH", "BOH"])]);
const cook = person("cook", [at("EAS", "staff", ["BOH"])]);
const floater = person("flt", [at("EAS", "staff", ["BOH"]), at("WEM", "staff", ["PROD"])]);
const sydOnly = person("syd", [at("SYD", "staff", ["FOH"])]);
const twoGroups = person("two", [at("EAS", "staff", ["FOH"]), at("SYD", "staff", ["FOH"])]);
const ALL = ["EAS", "WEM", "SYD"] as const;

describe("operations manager: the role", () => {
  it("sits between the owner and the site managers", () => {
    expect([owner, ops, mgr, cook].map((p) => [isOwner(p), isOps(p), isLead(p)])).toEqual([
      [true, false, true], [false, true, true], [false, false, false], [false, false, false],
    ]);
    // An owner who is also an operations manager somewhere is still an owner.
    const both = person("both", [at("EAS", "owner"), at("WEM", "ops")]);
    expect([isOwner(both), isOps(both), isLead(both)]).toEqual([true, false, true]);
  });
  it("runs only their own sites; owners run every site", () => {
    expect(opsSites(ops)).toEqual(["EAS", "WEM"]);
    expect(leadSites(owner, [...ALL])).toEqual(["EAS", "WEM", "SYD"]);
    expect(leadSites(ops, ["SYD", "WEM", "EAS"])).toEqual(["WEM", "EAS"]); // in the order given
    expect(leadSites(mgr, [...ALL])).toEqual([]);
  });
  it("manages their sites like a manager: reports, records, notices, time off, certificates, alerts", () => {
    expect(managedSites(ops)).toEqual(["EAS", "WEM"]);
    expect(canManage(ops, "WEM")).toBe(true);
    expect(canManage(ops, "SYD")).toBe(false);
  });
  it("keeps the full app on their own phone or laptop (a session with no tablet), at the sites they run; staff don't", () => {
    expect(sessionDeviceOk(undefined, undefined, runsSite(ops, "EAS"))).toBe(true);
    expect(sessionDeviceOk(undefined, undefined, runsSite(ops, "SYD"))).toBe(false);
    expect(sessionDeviceOk(undefined, undefined, runsSite(mgr, "EAS"))).toBe(false);
    expect(sessionDeviceOk(undefined, undefined, runsSite(mgr, "EAS"), "shifts")).toBe(true);
    expect(["EAS", "WEM", "SYD"].map((s) => runsSite(owner, s as "EAS"))).toEqual([true, true, true]);
  });
  it("signing in by staff ID on their own device lands at an open site they run (the full app); others get My shifts", () => {
    const sites = [site("EAS"), site("WEM"), site("SYD", "closed")];
    // Operations manager at Wembley, also on the Eastcote rota as staff: Wembley, not Eastcote.
    const mixed = person("mix", [at("EAS", "staff", ["FOH"]), at("WEM", "ops")]);
    expect(remoteSignIn(mixed, sites)).toEqual({ site: sites[1], scope: "full" });
    expect(remoteSignIn(ops, sites)).toEqual({ site: sites[0], scope: "full" });
    expect(remoteSignIn(cook, sites)).toEqual({ site: sites[0], scope: "shifts" });
    expect(remoteSignIn(owner, [site("EAS", "closed"), site("WEM"), site("SYD", "closed")])).toEqual({ site: site("WEM"), scope: "full" });
    // Their only site is closed: nothing for an operations manager or staff, the full app for an owner.
    expect(remoteSignIn(ops2, sites)).toBeUndefined();
    expect(remoteSignIn(sydOnly, sites)).toBeUndefined();
    expect(remoteSignIn(person("o", [at("SYD", "owner")]), sites)).toEqual({ site: sites[2], scope: "full" });
    // Operations manager whose sites are closed but who is staff at an open one: My shifts there.
    expect(remoteSignIn(person("m2", [at("EAS", "staff", ["FOH"]), at("SYD", "ops")]), sites)).toEqual({ site: sites[0], scope: "shifts" });
  });
  it("Work at: only sites they run and have access to, open ones (owners, closed ones too)", () => {
    const mixed = person("mix", [at("EAS", "staff", ["FOH"]), at("WEM", "ops")]);
    expect(canSwitchTo(mixed, site("WEM"))).toBe(true);
    expect(canSwitchTo(mixed, site("EAS"))).toBe(false); // only staff there
    expect(canSwitchTo(ops, site("SYD"))).toBe(false);
    expect(canSwitchTo(ops, site("EAS", "closed"))).toBe(false);
    expect(canSwitchTo(owner, site("SYD", "closed"))).toBe(true);
    expect(canSwitchTo(person("o", [at("EAS", "owner")]), site("WEM"))).toBe(false); // no access there
  });
  it("mixed roles: manages where they're a manager, runs only where they're the operations manager", () => {
    const mixed = person("mix", [at("WEM", "ops"), at("SYD", "manager", ["FOH"])]);
    expect(managedSites(mixed)).toEqual(["WEM", "SYD"]);
    expect(leadSites(mixed, [...ALL])).toEqual(["WEM"]);
  });
  it("is locked out of a closed site like everyone but the owner, keeping their other sites", () => {
    expect(canSignIn(ops, site("EAS", "closed"), 0).allowed).toBe(false);
    expect(canSignIn(owner, site("EAS", "closed"), 0).allowed).toBe(true);
    const plan = planSiteClosure("EAS", [owner, ops, mgr, person("solo", [at("EAS", "ops")])], new Set(["WEM"] as const));
    expect(plan).toEqual({ freeze: ["mgr", "solo"], endSessionsOnly: ["ops"], untouched: ["own"] });
  });
  it("needs no sections (sees every section, like an owner); managers still choose theirs", () => {
    const SITES = [site("EAS"), site("WEM", "open", "production")];
    expect(validatePersonInput({ name: "Olu", staffCode: "20", access: [at("EAS", "ops"), at("WEM", "ops")] }, SITES, [])).toMatchObject({ ok: true });
    expect(validatePersonInput({ name: "Mia", staffCode: "21", access: [at("EAS", "manager")] }, SITES, [])).toMatchObject({ ok: false, error: "Choose at least one section at EAS" });
  });
  it("is held to the managers' certificates (Level 3)", () => {
    expect(expectedKinds(ops)).toContain("food_hygiene_l3");
    expect(expectedKinds(cook)).not.toContain("food_hygiene_l3");
    expect(expectedKinds(owner)).toEqual([]);
  });
});

describe("operations manager: staff accounts", () => {
  it("gives staff and manager roles only; the owner gives any role", () => {
    expect(givableRoles(owner)).toEqual(["staff", "manager", "ops", "owner"]);
    expect(givableRoles(ops)).toEqual(["staff", "manager"]);
    expect(givableRoles(mgr)).toEqual([]);
  });
  it("changes staff and managers who only work at their sites", () => {
    expect(canManageAccount(ops, cook)).toEqual({ ok: true, value: true });
    expect(canManageAccount(ops, mgr)).toEqual({ ok: true, value: true });
    expect(canManageAccount(ops, floater)).toEqual({ ok: true, value: true }); // Eastcote and Wembley: both theirs
  });
  it("leaves the rest to the owner: owners, operations managers, themself, and anyone also working elsewhere", () => {
    expect(canManageAccount(ops, owner)).toMatchObject({ ok: false, error: "Only the owner can change an owner's or operations manager's account" });
    expect(canManageAccount(ops, ops2)).toMatchObject({ ok: false, error: "Only the owner can change an owner's or operations manager's account" });
    expect(canManageAccount(ops, ops)).toMatchObject({ ok: false, error: "Ask the owner to change your own account" });
    expect(canManageAccount(ops, twoGroups)).toMatchObject({ ok: false, error: "They also work at a site you don't run, so the owner changes their account" });
    expect(canManageAccount(ops, sydOnly)).toMatchObject({ ok: false });
    expect(canManageAccount(mgr, cook)).toMatchObject({ ok: false });
  });
  it("the owner can change anyone, operations managers included", () => {
    for (const p of [ops, ops2, mgr, cook, twoGroups, owner]) expect(canManageAccount(owner, p).ok).toBe(true);
  });
  it("can't make anyone an owner or operations manager, or give access to another site", () => {
    expect(canGiveAccess(ops, [at("EAS", "staff"), at("WEM", "manager")])).toEqual({ ok: true, value: true });
    expect(canGiveAccess(ops, [at("EAS", "ops")])).toMatchObject({ ok: false, error: "Only the owner can make someone an owner or operations manager" });
    expect(canGiveAccess(ops, [at("EAS", "owner")])).toMatchObject({ ok: false, error: "Only the owner can make someone an owner or operations manager" });
    expect(canGiveAccess(ops, [at("EAS", "staff"), at("SYD", "staff")])).toMatchObject({ ok: false, error: "You can only give access to sites you run" });
    expect(canGiveAccess(owner, [at("SYD", "ops"), at("EAS", "owner")]).ok).toBe(true);
    expect(canGiveAccess(mgr, [at("EAS", "staff")]).ok).toBe(false);
  });
  it("can't lift a freeze that came from the owner closing a site, by any route; a freeze on its own, yes", () => {
    const closed = { ...cook, status: "frozen" as const, frozenReason: "site:EAS" };
    const held = { ...cook, status: "frozen" as const, frozenReason: "owner" };
    const everyone = [owner, ops, closed];
    expect(canUnfreeze(ops, closed)).toMatchObject({ ok: false, error: "Frozen because their site is closed. It ends when the owner reopens the site" });
    expect(canUnfreeze(ops, held).ok).toBe(true);
    expect(canUnfreeze(owner, closed).ok).toBe(true);
    expect(canUnfreeze(ops, cook)).toMatchObject({ ok: false, error: "This account isn't frozen" });
    // Freezing again (which would replace the closure's reason) isn't possible.
    expect(canFreeze(ops, closed, everyone)).toMatchObject({ allowed: false, reason: "This account is already frozen" });
    expect(canFreeze(owner, closed, everyone).allowed).toBe(false);
    // Nor is marking them as left and rejoining: leaving is the owner's while the closure's freeze is on.
    expect(canMarkLeft(ops, closed, everyone)).toMatchObject({ ok: false });
    expect(canMarkLeft(owner, closed, everyone).ok).toBe(true);
    expect(canMarkLeft(ops, held, everyone).ok).toBe(true);
    // Rejoin is only for someone who has left (it would otherwise unfreeze them).
    expect(canRejoin(closed)).toMatchObject({ ok: false, error: "They haven't been marked as left" });
    expect(canRejoin({ status: "left" }).ok).toBe(true);
    expect(canMarkLeft(owner, { ...cook, status: "left" }, everyone)).toMatchObject({ ok: false });
    expect(canFreeze(owner, { ...cook, status: "left" }, everyone)).toMatchObject({ allowed: false, reason: "This person has left" });
  });
  it("can't change the account of someone who can see right to work checks", () => {
    expect(canManageAccount(ops, { ...mgr, seesRightToWork: true })).toMatchObject({ ok: false, error: "Only the owner can change this account" });
    expect(canManageAccount(owner, { ...mgr, seesRightToWork: true }).ok).toBe(true);
  });
  it("isn't told who holds a staff ID at a site they don't run", () => {
    const SITES = [site("EAS"), site("SYD")];
    const syd = { ...sydOnly, name: "Sam", staffCode: "030" };
    const input = { name: "New", staffCode: "30", access: [at("EAS", "staff", ["FOH"])] };
    const canSee = (p: Person) => accountsFor(ops, [p]).length > 0;
    expect(validatePersonInput(input, SITES, [syd], undefined, canSee)).toMatchObject({ ok: false, error: "030 is already used by someone at another site" });
    expect(validatePersonInput(input, SITES, [syd])).toMatchObject({ ok: false, error: "030 is already used by Sam" });
  });
  it("sees the accounts at their sites on the overview; the owner sees everyone", () => {
    const everyone = [owner, ops, ops2, mgr, cook, floater, sydOnly, twoGroups];
    expect(accountsFor(owner, everyone)).toHaveLength(everyone.length);
    expect(accountsFor(ops, everyone).map((p) => p.id)).toEqual(["own", "ops", "mgr", "cook", "flt", "two"]);
    expect(accountsFor(mgr, everyone)).toEqual([]);
  });
});

describe("operations manager: time off", () => {
  const req = (personId: string, over: Partial<TimeOff> = {}): TimeOff => ({ id: "t", personId, personName: personId, siteId: "EAS",
    startsOn: "2026-10-20", endsOn: "2026-10-22", kind: "holiday", status: "pending", createdAt: 1, ...over });
  it("decides staff and managers' time off at their sites, not their own", () => {
    expect(canDecide(ops, req("cook"), cook)).toEqual({ ok: true });
    expect(canDecide(ops, req("mgr"), mgr)).toEqual({ ok: true });
    expect(canDecide(ops, req("syd", { siteId: "SYD" }), sydOnly)).toMatchObject({ ok: false });
  });
  it("their own time off is decided by the owner, never a site manager or another operations manager", () => {
    const theirs = req("ops");
    expect(canDecide(owner, theirs, ops)).toEqual({ ok: true });
    expect(canDecide(mgr, theirs, ops)).toMatchObject({ ok: false, error: "The owner decides an operations manager's time off" });
    expect(canDecide(ops, theirs, ops)).toMatchObject({ ok: false, error: "The owner decides an operations manager's time off" });
    const otherOps = person("ops3", [at("EAS", "ops")]);
    expect(canDecide(otherOps, theirs, ops)).toMatchObject({ ok: false });
  });
  it("only the owners are told about an operations manager's request; a cook's goes to everyone who manages the site", () => {
    const everyone = [owner, ops, mgr, cook, person("gone", [at("EAS", "owner")], { status: "left" })];
    expect(timeOffDeciders(everyone, ops, "EAS").map((p) => p.id)).toEqual(["own"]);
    expect(timeOffDeciders(everyone, cook, "EAS").map((p) => p.id)).toEqual(["own", "ops", "mgr"]);
    expect(timeOffDeciders(everyone, mgr, "EAS").map((p) => p.id)).toEqual(["own", "ops"]);
  });
  it("site managers don't see an operations manager's request on their list; the owner and they do", () => {
    expect(seesRequest(mgr, req("ops"), ops)).toBe(false);
    expect(seesRequest(owner, req("ops"), ops)).toBe(true);
    expect(seesRequest(ops, req("ops"), ops)).toBe(true);
    expect(seesRequest(mgr, req("cook"), cook)).toBe(true);
  });
});

describe("operations manager: certificates and notices", () => {
  it("keeps certificates at their sites, never right to work", () => {
    expect(canEditCerts(ops, cook, "allergen").ok).toBe(true);
    expect(canEditCerts(ops, cook, "right_to_work")).toMatchObject({ ok: false, error: "Right to work checks are private to the owner" });
    expect(canEditCerts(ops, sydOnly, "allergen").ok).toBe(false);
  });
  it("their own certificate reminders point them to the owner", () => {
    const today = "2026-10-12";
    const [mine] = certReminderMessages([ops, owner], [{ id: "c1", personId: "ops", kind: "food_hygiene_l3", expiresOn: "2026-10-19", createdBy: "own", createdAt: 1 }], today).filter((m) => m.personId === "ops");
    expect(mine.body).toContain("Speak to the owner");
  });
  it("posts to their own sites; \"all sites\" only for someone who manages every site, closed ones included", () => {
    expect(canPostTo(managedSites(ops), [...ALL], "EAS")).toBe(true);
    expect(canPostTo(managedSites(ops), [...ALL], "SYD")).toBe(false);
    expect(canPostTo(managedSites(ops), [...ALL], undefined)).toBe(false); // Sydenham is closed, but it's still a site
    expect(canPostTo(managedSites(owner), [...ALL], undefined)).toBe(true);
  });
});

describe("operations manager: messages and activity", () => {
  it("alerts at their sites link to their overview", () => {
    const ready = readyToOpen({ date: "2026-10-14", readyBy: "12:00", now: londonToUtc("2026-10-14", "12:05"), lists: [{ name: "FOH Opening", due: "11:30", signed: false }], kitDown: [], alerts: [], team: [] });
    const m = notReadyMessages({ id: "EAS", name: "Eastcote" }, "2026-10-14", ready, [owner, ops, mgr]);
    expect(m.map((x) => [x.personId, x.url])).toEqual([["own", "/owner"], ["ops", "/owner"], ["mgr", "/today"]]);
    const shift = { id: "s1", personId: "cook", siteId: "EAS" as const, siteName: "Eastcote", section: "BOH", date: "2026-10-14", start: "11:00", end: "22:15" };
    const r = replyMessages({ id: "r1", shiftId: "s1", personId: "cook", siteId: "EAS", kind: "late", lateMinutes: 15, createdAt: 0 }, undefined, shift, "Cook", [owner, ops, mgr], "2026-10-14");
    expect(r.map((x) => [x.personId, x.url])).toEqual([["own", "/owner"], ["ops", "/owner"], ["mgr", "/today"]]);
  });
  it("activity: their sites and their own actions, never right to work; the owner sees it all", () => {
    const log = [
      { actorId: "mgr", siteId: "EAS", action: "timeoff.approve", detail: "Approved Cook" },
      { actorId: "x", siteId: "SYD", action: "signin", detail: "Signed in" },
      { actorId: "ops", action: "person.update", detail: "Cook (003): details updated" },
      { actorId: "own", action: "person.update", detail: "Someone at Sydenham" },
      { actorId: "own", siteId: "EAS", action: "cert.add", detail: "Right to work check recorded for Cook" },
      { actorId: "own", siteId: "EAS", action: "cert.remove", detail: "Removed a Right to work check record for Cook" },
      { actorId: "mgr", siteId: "EAS", action: "cert.add", detail: "Allergen awareness recorded for Cook (runs out 1 Oct 2029)" },
    ];
    expect(activityFor(ops, log, ["EAS", "WEM"]).map((e) => e.detail)).toEqual(["Approved Cook", "Cook (003): details updated", "Allergen awareness recorded for Cook (runs out 1 Oct 2029)"]);
    expect(activityFor(owner, log, [...ALL])).toHaveLength(log.length);
    // Someone allowed to see right to work (only if the owner decides so) would see those lines too.
    expect(activityFor({ ...ops, seesRightToWork: true }, log, ["EAS", "WEM"])).toHaveLength(5);
  });
});
