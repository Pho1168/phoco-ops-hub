import { describe, expect, it } from "vitest";
import {
  askMessages, canAskCover, canCancelCover, canCover, canDecideCover, canOffer, canWithdraw, cancelMessages, coverSendAfter, coverState, decisionMessages,
  offerMessages, offerWithdrawnMessages, pendingCovers, withdrawMessages, type CoverRequest,
} from "./cover";
import { londonToUtc } from "./time";
import type { TimeOff } from "./timeoff";
import type { Person } from "./types";

const at = londonToUtc;
const shift = { id: "s1", personId: "anh", siteId: "EAS" as const, section: "BOH", date: "2026-10-17", start: "11:00", end: "22:15", published: true, cancelled: false };
const req = (over: Partial<CoverRequest> = {}): CoverRequest => ({
  id: "c1", shiftId: "s1", siteId: "EAS", siteName: "Eastcote", personId: "anh", personName: "Anh", section: "BOH", date: "2026-10-17", start: "11:00", end: "22:15",
  status: "open", createdAt: at("2026-10-14", "10:00"), shiftCancelled: false, shiftPersonId: "anh", covererOnRota: false, offers: [], ...over,
});
const person = (id: string, access: Person["access"], status: Person["status"] = "active") => ({ id, status, access });
const boh = (id: string, status: Person["status"] = "active") => person(id, [{ siteId: "EAS", role: "staff", sections: ["BOH"] }], status);
const people = [
  boh("anh"), boh("bo"), boh("cy"),
  person("dee", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }]),
  person("wes", [{ siteId: "WEM", role: "staff", sections: ["PROD"] }]),
  person("mgr", [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }]),
  person("own", [{ siteId: "EAS", role: "owner", sections: [] }]),
];
const off = (personId: string, startsOn: string, endsOn: string, status: TimeOff["status"] = "approved"): TimeOff =>
  ({ id: `t-${personId}`, personId, personName: personId, siteId: "EAS", startsOn, endsOn, kind: "holiday", status, createdAt: 0 });

describe("asking for cover", () => {
  const now = at("2026-10-14", "12:00");
  it("your own published shift that hasn't started, once", () => {
    expect(canAskCover(shift, "anh", [], now)).toEqual({ ok: true });
    expect(canAskCover(shift, "bo", [], now)).toMatchObject({ ok: false, error: "That isn't your shift" });
    expect(canAskCover({ ...shift, published: false }, "anh", [], now).ok).toBe(false);
    expect(canAskCover({ ...shift, cancelled: true }, "anh", [], now).ok).toBe(false);
    expect(canAskCover(shift, "anh", [], at("2026-10-17", "11:00")).ok).toBe(false);
    expect(canAskCover(shift, "anh", [{ shiftId: "s1", status: "open" }], now)).toMatchObject({ ok: false, error: "You've already asked for cover for this shift" });
    expect(canAskCover(shift, "anh", [{ shiftId: "s1", status: "declined" }], now).ok).toBe(true); // can ask again after a no
  });
});

describe("who can cover", () => {
  it("same site and section, not the person asking, active", () => {
    expect(canCover(boh("bo"), req(), [], [])).toEqual({ ok: true });
    expect(canCover(boh("anh"), req(), [], []).ok).toBe(false);
    expect(canCover(boh("bo", "frozen"), req(), [], []).ok).toBe(false);
    expect(canCover(people[3], req(), [], [])).toMatchObject({ ok: false, error: "Only back of house staff at that site can cover it" });
    expect(canCover(people[4], req(), [], []).ok).toBe(false);
  });
  it("reasons are worded for the manager when a name is given", () => {
    expect(canCover(boh("bo"), req(), [{ date: "2026-10-17", start: "17:00", end: "23:00" }], [], "Bo")).toMatchObject({ error: "Bo is already working then" });
    expect(canCover(boh("bo"), req(), [], [off("bo", "2026-10-17", "2026-10-17")], "Bo")).toMatchObject({ error: "Bo is off that day" });
  });
  it("someone already approved to cover another shift then counts as busy", () => {
    const other = req({ id: "c2", shiftId: "s2", personId: "cy", status: "approved", coveredBy: "bo", start: "17:00", end: "23:00" });
    const busy = pendingCovers([other], at("2026-10-14", "12:00")).get("bo") ?? [];
    expect(canCover(boh("bo"), req(), busy, []).ok).toBe(false);
    // once the sheet shows it, it's a real shift instead, and a past or cancelled cover doesn't count
    expect(pendingCovers([{ ...other, shiftCancelled: true, covererOnRota: true }], at("2026-10-14", "12:00")).get("bo")).toBeUndefined();
    expect(pendingCovers([{ ...other, status: "cancelled" }], at("2026-10-14", "12:00")).get("bo")).toBeUndefined();
  });
  it("not already working then (any site, including a shift from the night before), and not off that day", () => {
    const d = "2026-10-17";
    expect(canCover(boh("bo"), req(), [{ date: d, start: "17:00", end: "23:00" }], [])).toMatchObject({ ok: false, error: "You're already working then" });
    expect(canCover(boh("bo"), req(), [{ date: d, start: "07:00", end: "11:00" }], []).ok).toBe(true); // ends as it starts
    expect(canCover(boh("bo"), req({ start: "00:30", end: "08:00" }), [{ date: "2026-10-16", start: "18:00", end: "01:00" }], []).ok).toBe(false);
    expect(canCover(boh("bo"), req(), [], [off("bo", "2026-10-16", "2026-10-18")])).toMatchObject({ ok: false, error: "You're off that day" });
    expect(canCover(boh("bo"), req(), [], [off("bo", "2026-10-16", "2026-10-18", "pending")]).ok).toBe(true);
  });
  it("offers while the request is open and the shift hasn't started, once each", () => {
    const now = at("2026-10-14", "12:00");
    expect(canOffer(req(), "bo", now)).toEqual({ ok: true });
    expect(canOffer(req({ status: "approved" }), "bo", now)).toMatchObject({ ok: false, error: "Someone is already covering it" });
    expect(canOffer(req(), "bo", at("2026-10-17", "11:00")).ok).toBe(false);
    expect(canOffer(req({ offers: [{ id: "o1", personId: "bo", personName: "Bo", createdAt: 1 }] }), "bo", now).ok).toBe(false);
    expect(canOffer(req({ offers: [{ id: "o1", personId: "bo", personName: "Bo", createdAt: 1, withdrawnAt: 2 }] }), "bo", now).ok).toBe(true);
    expect(canOffer(req({ shiftCancelled: true }), "bo", now)).toMatchObject({ ok: false, error: "The rota has changed: this shift isn't Anh's any more" });
  });
});

describe("deciding", () => {
  const now = at("2026-10-14", "12:00");
  const offered = req({ offers: [{ id: "o1", personId: "bo", personName: "Bo", createdAt: 1 }, { id: "o2", personId: "cy", personName: "Cy", createdAt: 2, withdrawnAt: 3 }] });
  it("a manager of the site approves someone who has offered, before the shift", () => {
    expect(canDecideCover(people[5], offered, "bo", now)).toEqual({ ok: true });
    expect(canDecideCover(people[5], offered, "cy", now)).toMatchObject({ ok: false }); // took their offer back
    expect(canDecideCover(people[1], offered, "bo", now)).toMatchObject({ ok: false, error: "Only a manager of that site can decide this" });
    expect(canDecideCover(people[5], { ...offered, status: "withdrawn" }, "bo", now).ok).toBe(false);
    expect(canDecideCover(people[5], offered, "bo", at("2026-10-17", "11:05")).ok).toBe(false);
    expect(canDecideCover(people[5], offered, undefined, at("2026-10-17", "11:05")).ok).toBe(true); // declining is still fine
  });
  it("not your own request, unless you're the owner", () => {
    expect(canDecideCover(people[5], req({ personId: "mgr", shiftPersonId: "mgr" }), undefined, now).ok).toBe(false);
    expect(canDecideCover(people[6], req({ personId: "own", shiftPersonId: "own" }), undefined, now).ok).toBe(true);
  });
  it("not once the rota sheet has moved the shift", () => {
    expect(canDecideCover(people[5], { ...offered, shiftPersonId: "dee" }, "bo", now)).toMatchObject({ ok: false });
    expect(canDecideCover(people[5], { ...offered, shiftCancelled: true }, undefined, now)).toMatchObject({ ok: false });
  });
  it("a manager can cancel an approval until the shift ends", () => {
    const approved = req({ status: "approved", coveredBy: "bo" });
    expect(canCancelCover(people[5], approved, now)).toEqual({ ok: true });
    expect(canCancelCover(people[1], approved, now).ok).toBe(false);
    expect(canCancelCover(people[5], req(), now).ok).toBe(false);
    expect(canCancelCover(people[5], approved, at("2026-10-17", "22:15")).ok).toBe(false);
  });
  it("the person asking can withdraw while it's open, before the shift", () => {
    expect(canWithdraw(req(), "anh", now)).toEqual({ ok: true });
    expect(canWithdraw(req(), "bo", now).ok).toBe(false);
    expect(canWithdraw(req({ status: "approved", coveredBy: "bo" }), "anh", now)).toMatchObject({ ok: false, error: "It's been approved. Talk to your manager to change it" });
    expect(canWithdraw(req(), "anh", at("2026-10-17", "11:00")).ok).toBe(false);
  });
});

describe("where a request stands", () => {
  const before = at("2026-10-14", "12:00");
  it("open until the shift starts, then expired; closed if the rota sheet moves the shift first", () => {
    expect(coverState(req(), before)).toBe("open");
    expect(coverState(req(), at("2026-10-17", "11:00"))).toBe("expired");
    expect(coverState(req({ shiftCancelled: true }), before)).toBe("rota_changed");
    expect(coverState(req({ shiftPersonId: "dee" }), before)).toBe("rota_changed");
  });
  it("approved until the rota sheet shows the coverer on, then done; past if the shift ends first", () => {
    const approved = req({ status: "approved", coveredBy: "bo" });
    expect(coverState(approved, before)).toBe("approved");
    expect(coverState({ ...approved, shiftCancelled: true }, before)).toBe("approved"); // removed, but not given to Bo yet
    expect(coverState({ ...approved, shiftCancelled: true, covererOnRota: true }, before)).toBe("done");
    expect(coverState(approved, at("2026-10-17", "22:15"))).toBe("past");
    expect(coverState(req({ status: "declined" }), before)).toBe("declined");
    expect(coverState(req({ status: "withdrawn" }), before)).toBe("withdrawn");
    expect(coverState(req({ status: "cancelled", coveredBy: "bo" }), before)).toBe("cancelled");
  });
});

describe("cover messages", () => {
  it("asks the people who could cover (without the reason), tells managers (with it), and nobody twice", () => {
    const m = askMessages(req({ note: "Dentist" }), ["bo", "cy", "mgr"], people);
    expect(m.map((x) => x.personId).sort()).toEqual(["bo", "cy", "mgr", "own"]);
    expect(m.find((x) => x.personId === "bo")).toMatchObject({ title: "Can you cover? Sat 17 Oct 11:00–22:15 · Eastcote", url: "/me" });
    expect(m.find((x) => x.personId === "bo")?.body).toBe("Anh is asking for cover (Back of house). Tap to offer.");
    expect(m.find((x) => x.personId === "own")?.body).toContain('"Dentist"');
    expect(m.find((x) => x.personId === "own")).toMatchObject({ title: "Cover needed: Anh", url: "/manage/cover" });
    expect(m.find((x) => x.personId === "mgr")?.title).toBe("Cover needed: Anh"); // a manager who could cover is told as a manager
    expect(new Set(m.map((x) => x.dedupeKey)).size).toBe(m.length);
  });
  it("an offer goes to the managers and the person asking", () => {
    const m = offerMessages(req(), "o1", { id: "bo", name: "Bo" }, people);
    expect(m.map((x) => x.personId).sort()).toEqual(["anh", "mgr", "own"]);
    expect(m.find((x) => x.personId === "mgr")?.title).toBe("Bo can cover Anh");
  });
  it("the decision goes to the person asking, the one covering, and anyone else who offered", () => {
    const r = req({ offers: [{ id: "o1", personId: "bo", personName: "Bo", createdAt: 1 }, { id: "o2", personId: "cy", personName: "Cy", createdAt: 2 }] });
    const yes = decisionMessages(r, "approved", { id: "bo", name: "Bo" }, "Mia");
    expect(yes.map((x) => [x.personId, x.title])).toEqual([["anh", "Cover approved: Sat 17 Oct 11:00"], ["bo", "You're covering Anh's shift"], ["cy", "Thanks for offering"]]);
    const no = decisionMessages(r, "declined", undefined, "Mia", "We're short that day");
    expect(no[0]).toMatchObject({ personId: "anh", title: "Cover not approved: Sat 17 Oct 11:00", body: "Mia: We're short that day" });
    expect(no.slice(1).map((x) => x.personId)).toEqual(["bo", "cy"]);
  });
  it("an offer taken back tells the managers and the person asking", () => {
    const m = offerWithdrawnMessages(req(), "o1", { id: "bo", name: "Bo" }, people);
    expect(m.map((x) => [x.personId, x.title]).sort()).toEqual([["anh", "Bo can't cover your shift after all"], ["mgr", "Bo can't cover Anh after all"], ["own", "Bo can't cover Anh after all"]]);
  });
  it("a cancelled approval gives the shift back and tells the person who was covering", () => {
    const m = cancelMessages(req({ status: "approved", coveredBy: "bo" }), "Mia", "Bo is ill");
    expect(m.map((x) => [x.personId, x.title])).toEqual([["anh", "Cover cancelled: Sat 17 Oct 11:00"], ["bo", "You're no longer covering Anh"]]);
    expect(m[0].body).toBe('Your Sat 17 Oct 11:00–22:15 shift is yours again.\nMia: "Bo is ill"');
  });
  it("a withdrawn request tells managers and anyone who offered", () => {
    const m = withdrawMessages(req({ offers: [{ id: "o1", personId: "bo", personName: "Bo", createdAt: 1 }] }), people);
    expect(m.map((x) => [x.personId, x.url]).sort()).toEqual([["bo", "/me"], ["mgr", "/manage/cover"], ["own", "/manage/cover"]]);
  });
  it("go straight away (until midnight) when the shift is within 12 hours, otherwise wait out quiet hours", () => {
    expect(coverSendAfter(at("2026-10-16", "23:30"), req())).toBe(at("2026-10-16", "23:30"));
    expect(coverSendAfter(at("2026-10-14", "23:30"), req())).toBe(at("2026-10-15", "08:00"));
  });
});
