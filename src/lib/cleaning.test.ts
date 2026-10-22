import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { addMonths, canAct, cleaningBoard, cleaningSummary, comingDue, dueMessage, howOften, jobView, missedJobs, missedMessage, periodEnd, periodStart, previousPeriod, statusLine, urgencyOf, type CleaningEvent, type CleaningJob } from "@/lib/domain/cleaning";
import { boardRows, cleaningBoards, queueCleaningMissed } from "@/lib/cleaning-service";
import { londonToUtc } from "@/lib/domain/time";

// Runs against the in-memory demo store only, never a real database.
const at = (date: string, hm = "12:00") => londonToUtc(date, hm);
const job = (over: Partial<CleaningJob> = {}): CleaningJob => ({ id: "J1", siteId: "EAS", area: "BOH", name: "Grease traps", per: "week", times: 2, position: 1, active: true, createdAt: at("2026-09-01"), ...over });
let n = 0;
const ev = (kind: CleaningEvent["kind"], period: string, when: number, personId?: string, personName?: string, jobId = "J1"): CleaningEvent =>
  ({ id: `e${++n}`, jobId, period, kind, personId, personName, at: when });

beforeEach(() => { resetDemo(); });

describe("cleaning periods", () => {
  it("weeks run Monday to Sunday (London) and months from the 1st", () => {
    expect(periodStart("week", at("2026-10-20"))).toBe("2026-10-19"); // a Tuesday
    expect(periodStart("week", at("2026-10-25", "23:30"))).toBe("2026-10-19"); // Sunday night, London
    expect(periodStart("week", at("2026-10-26", "00:10"))).toBe("2026-10-26");
    expect(periodStart("month", at("2026-10-31"))).toBe("2026-10-01");
    expect(periodEnd("month", "2026-12-01")).toBe("2027-01-01");
    expect(previousPeriod("month", "2026-01-01")).toBe("2025-12-01");
    expect(previousPeriod("week", "2026-10-19")).toBe("2026-10-12");
  });
  it("a week is due soon from Thursday and due now on Sunday; twice a week with none done, from Wednesday", () => {
    const once = job({ times: 1 }), twice = job();
    expect(urgencyOf(once, "2026-10-19", 0, at("2026-10-21"))).toBe("ok"); // Wed
    expect(urgencyOf(twice, "2026-10-19", 0, at("2026-10-21"))).toBe("soon");
    expect(urgencyOf(twice, "2026-10-19", 1, at("2026-10-21"))).toBe("ok");
    expect(urgencyOf(once, "2026-10-19", 0, at("2026-10-22"))).toBe("soon"); // Thu
    expect(urgencyOf(once, "2026-10-19", 0, at("2026-10-25"))).toBe("late"); // Sun
    expect(urgencyOf(once, "2026-10-19", 1, at("2026-10-25"))).toBe("ok");
    const month = job({ per: "month", times: 1 });
    expect(urgencyOf(month, "2026-10-01", 0, at("2026-10-20"))).toBe("ok");
    expect(urgencyOf(month, "2026-10-01", 0, at("2026-10-23"))).toBe("soon");
    expect(urgencyOf(month, "2026-10-01", 0, at("2026-10-30"))).toBe("late");
  });
});

describe("who has a job", () => {
  it("a claim lasts until it's let go or done; done twice finishes a twice-a-week job", () => {
    const j = job();
    const now = at("2026-10-22");
    const events = [ev("claimed", "2026-10-19", at("2026-10-20", "10:00"), "P1", "Jamie Smith")];
    let v = jobView(j, events, now);
    expect(v.claimed?.personId).toBe("P1");
    expect(statusLine(v)).toBe("0 of 2 done · Jamie is doing it");
    events.push(ev("done", "2026-10-19", at("2026-10-20", "11:00"), "P1", "Jamie Smith"));
    v = jobView(j, events, now);
    expect(v.claimed).toBeUndefined();
    expect(v.complete).toBe(false);
    expect(statusLine(v)).toBe("1 of 2 done · Nobody has taken it yet");
    events.push(ev("claimed", "2026-10-19", at("2026-10-21", "09:00"), "P2", "Sam"), ev("released", "2026-10-19", at("2026-10-21", "09:30"), "P2", "Sam"));
    expect(jobView(j, events, now).claimed).toBeUndefined();
    events.push(ev("done", "2026-10-19", at("2026-10-22", "09:00"), "P2", "Sam"));
    v = jobView(j, events, now);
    expect(v.complete).toBe(true);
    expect(statusLine(v)).toBe("Done 2 of 2 · last Thu by Sam");
    expect(v.urgency).toBe("ok");
  });
  it("last week's work doesn't count this week", () => {
    const v = jobView(job({ times: 1 }), [ev("done", "2026-10-12", at("2026-10-16"), "P1", "Jamie")], at("2026-10-20"));
    expect(v.complete).toBe(false);
    expect(v.lastDone?.period).toBe("2026-10-12");
  });
  it("anyone can take a job over; only the person who has it lets go; nothing once it's done", () => {
    const claimed = { complete: false, claimed: { personId: "P1", at: 0 } };
    expect(canAct(claimed, "claimed", "P2").ok).toBe(true);
    expect(canAct(claimed, "claimed", "P1").ok).toBe(false);
    expect(canAct(claimed, "released", "P2").ok).toBe(false);
    expect(canAct(claimed, "released", "P1").ok).toBe(true);
    expect(canAct(claimed, "done", "P2").ok).toBe(true);
    expect(canAct({ complete: true }, "done", "P1").ok).toBe(false);
    expect(canAct({ complete: true }, "claimed", "P1").ok).toBe(false);
  });
  it("the board puts what's due first and what's done last", () => {
    const jobs = [job({ id: "A", name: "A", times: 1, position: 1 }), job({ id: "B", name: "B", times: 1, position: 2, per: "month" }), job({ id: "C", name: "C", times: 1, position: 3 })];
    const board = cleaningBoard(jobs, [ev("done", "2026-11-02", at("2026-11-03"), "P1", "Jamie", "A")], at("2026-11-05"));
    expect(board.map((v) => v.job.id)).toEqual(["C", "B", "A"]); // C due soon (Thu), B fine this month, A done
    expect(cleaningSummary(board)).toEqual({ total: 3, complete: 1, late: 0, soon: 1, missedLast: 0 });
  });
});

describe("missed jobs", () => {
  it("last week's or last month's jobs not done enough are missed, once, unless the job was only just added", () => {
    const jobs = [job(), job({ id: "J2", name: "Drain", times: 1 }), job({ id: "J3", name: "Fly killer", per: "month", times: 1 }), job({ id: "J4", name: "New", times: 1, createdAt: at("2026-10-24") })];
    const events = [ev("done", "2026-10-19", at("2026-10-21"), "P1", "Jamie"), ev("done", "2026-10-19", at("2026-10-23"), "P1", "Jamie", "J2")];
    const now = at("2026-10-26", "07:00");
    const missed = missedJobs(jobs, events, now);
    expect(missed.map((m) => [m.job.id, m.period, m.count])).toEqual([["J1", "2026-10-19", 1], ["J3", "2026-09-01", 0]]);
    expect(missedJobs(jobs, [...events, ev("missed", "2026-10-19", now), ev("missed", "2026-09-01", now, undefined, undefined, "J3")], now)).toEqual([]);
    expect(missedMessage("Eastcote", missed.slice(0, 1))).toEqual({ title: "Eastcote: 1 cleaning job missed", body: "Not done in the week of Mon 19 Oct: Grease traps (1 of 2)." });
  });
  it("tick() marks them once and tells the site's managers and owners, not staff", async () => {
    const now = Date.now();
    const jobs = await db.cleaningJobs(["EAS"]);
    expect(jobs.length).toBeGreaterThan(0);
    // The demo jobs have been there all along, so last week and last month were missed.
    const first = await queueCleaningMissed(now, db);
    expect(first).toBeGreaterThan(0);
    expect(await queueCleaningMissed(now, db)).toBe(0);
    const owner = await db.notices("DEMO-OWN", 20);
    expect(owner.some((x) => x.kind === "cleaning" && x.title.startsWith("Eastcote:"))).toBe(true);
    expect((await db.notices("DEMO-MGR", 20)).some((x) => x.kind === "cleaning")).toBe(true);
    expect((await db.notices("DEMO-BOH", 20)).some((x) => x.kind === "cleaning")).toBe(false);
    const board = (await cleaningBoards(db, ["EAS"], now)).get("EAS")!;
    expect(board.filter((v) => v.job.per !== "every").every((v) => v.missedLast)).toBe(true);
  });
});

describe("the board in the demo store", () => {
  it("claim, let go and done are checked against the board as it is", async () => {
    const now = Date.now();
    const [grease] = (await db.cleaningJobs(["EAS"])).filter((j) => j.name === "Grease traps");
    expect((await db.cleaningAct(grease.id, "released", "DEMO-BOH", now)).ok).toBe(false);
    expect((await db.cleaningAct(grease.id, "claimed", "DEMO-BOH", now)).ok).toBe(true);
    expect((await db.cleaningAct(grease.id, "claimed", "DEMO-BOH", now)).ok).toBe(false);
    let rows = boardRows((await cleaningBoards(db, ["EAS"], now)).get("EAS")!, "DEMO-BOH");
    expect(rows.find((r) => r.id === grease.id)).toMatchObject({ mine: true, complete: false, often: "Twice a week" });
    expect((await db.cleaningAct(grease.id, "done", "DEMO-BOH", now)).ok).toBe(true);
    expect((await db.cleaningAct(grease.id, "done", "DEMO-MGR", now + 1)).ok).toBe(true);
    expect((await db.cleaningAct(grease.id, "done", "DEMO-MGR", now + 2)).ok).toBe(false);
    rows = boardRows((await cleaningBoards(db, ["EAS"], now + 3)).get("EAS")!, "DEMO-BOH");
    expect(rows.find((r) => r.id === grease.id)).toMatchObject({ complete: true });
    expect(rows.findIndex((r) => r.id === grease.id)).toBeGreaterThan(rows.findIndex((r) => !r.complete));
  });
});

describe("jobs done every few months", () => {
  const air = job({ id: "AC", name: "Air con cleaned", per: "every", times: 1, everyMonths: 6, firstDue: "2027-04-22" });
  it("stay off the board until two weeks before they're due, then stay on until done", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-10-22", 6)).toBe("2027-04-22");
    let v = jobView(air, [], at("2026-10-22"));
    expect(v).toMatchObject({ complete: true, dueOn: "2027-04-22" });
    expect(statusLine(v)).toBe("Next due 22 Apr 2027");
    expect(howOften(air)).toBe("Every 6 months");
    v = jobView(air, [], at("2027-04-09"));
    expect(v).toMatchObject({ complete: false, urgency: "soon" });
    expect(statusLine(v)).toBe("Nobody has taken it yet · due by 22 Apr 2027");
    expect(jobView(air, [], at("2027-05-30")).urgency).toBe("late"); // overdue: still there
    expect(comingDue([air], [], at("2027-04-09")).map((d) => d.due)).toEqual(["2027-04-22"]);
    expect(comingDue([air], [], at("2027-04-07"))).toEqual([]);
    expect(missedJobs([air], [], at("2027-06-01"))).toEqual([]);
  });
  it("once done, the next one is due six months after that", () => {
    const events = [ev("claimed", "2027-04-22", at("2027-04-10"), "P1", "Jamie", "AC"), ev("done", "2027-04-22", at("2027-04-12"), "P1", "Jamie", "AC")];
    const v = jobView(air, events, at("2027-04-13"));
    expect(v).toMatchObject({ complete: true, dueOn: "2027-10-12" });
    expect(statusLine(v)).toBe("Next due 12 Oct 2027 · last done 12 Apr 2027 by Jamie");
    expect(dueMessage("Eastcote", air, "2027-04-22").title).toBe("Eastcote: Air con cleaned due by 22 Apr 2027");
  });
});

