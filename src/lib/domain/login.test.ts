import { describe, expect, it } from "vitest";
import { loginGroups, roleLabel, toneOf, type LoginShift } from "./login";
import { firstName, initials } from "./names";
import type { Person } from "./types";

const person = (id: string, name: string, over: Partial<Person> = {}): Person => ({
  id, staffCode: id, name, status: "active", pinFailed: 0, access: [{ siteId: "EAS", role: "staff", sections: ["BOH"] }], ...over,
});
const shift = (personId: string, start: string, end: string, section = "BOH", siteId: "EAS" | "WEM" = "EAS"): LoginShift => ({ personId, siteId, section, start, end });

const sofia = person("sofia", "Sofia Marsh", { access: [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }] });
const minh = person("minh", "Minh Nguyen");
const an = person("an", "An Pham", { access: [{ siteId: "EAS", role: "staff", sections: ["BOH"] }, { siteId: "WEM", role: "staff", sections: ["PROD"] }] });
const daniel = person("daniel", "Daniel Okafor", { access: [{ siteId: "EAS", role: "staff", sections: ["FOH"] }] });
const ola = person("ola", "Ola Adeyemi", { status: "frozen" });
const gone = person("gone", "Someone Left", { status: "left" });
const owner = person("owner", "Tuan Le", { access: [{ siteId: "EAS", role: "owner", sections: [] }, { siteId: "WEM", role: "owner", sections: [] }] });
const wembley = person("hai", "Hai Vo", { access: [{ siteId: "WEM", role: "staff", sections: ["PROD"] }] });

describe("who the sign-in screen lists", () => {
  it("puts today's rota first, earliest start first, then everyone else by name with frozen accounts last", () => {
    const g = loginGroups([ola, minh, gone, sofia, an, daniel, owner, wembley], [shift("minh", "15:00", "23:00"), shift("sofia", "10:00", "18:00", "FOH"), shift("daniel", "11:00", "22:30", "FOH"), shift("an", "10:30", "16:00")], "EAS");
    expect(g.onToday.map((p) => p.id)).toEqual(["sofia", "an", "daniel", "minh"]);
    expect(g.others.map((p) => p.id)).toEqual(["owner", "ola"]);
    expect(g.firstIn).toBe("10:00");
  });
  it("labels a rota line with the lane and times, and everyone else with their role", () => {
    const g = loginGroups([sofia, minh, owner, daniel], [shift("minh", "15:00", "23:00")], "EAS");
    expect(g.onToday[0]).toMatchObject({ id: "minh", label: "Kitchen · 15:00–23:00", tone: "BOH", shift: { start: "15:00", end: "23:00" } });
    expect(g.others.map((p) => p.label)).toEqual(["Front of house", "Manager · Front of house · Kitchen", "Owner · all sites"]);
    expect(g.others.map((p) => p.tone)).toEqual(["FOH", "lead", "lead"]);
  });
  it("shows someone with two shifts once, with the first, and ignores other sites' shifts", () => {
    const g = loginGroups([an, minh], [shift("an", "16:00", "22:00"), shift("an", "08:00", "12:00"), shift("minh", "06:00", "14:00", "PROD", "WEM")], "EAS");
    expect(g.onToday.map((p) => [p.id, p.shift?.start])).toEqual([["an", "08:00"]]);
    expect(g.others.map((p) => p.id)).toEqual(["minh"]);
  });
  it("keeps a frozen person out of the rota group even if the sheet still has them on", () => {
    const g = loginGroups([ola], [shift("ola", "10:00", "16:00")], "EAS");
    expect(g.onToday).toEqual([]);
    expect(g.others[0]).toMatchObject({ id: "ola", frozen: true, label: "Frozen" });
  });
  it("names the role and picks an avatar tone", () => {
    expect(roleLabel(owner, "EAS")).toBe("Owner · all sites");
    expect(roleLabel(person("x", "X", { access: [{ siteId: "EAS", role: "ops", sections: [] }] }), "EAS")).toBe("Operations manager");
    expect(roleLabel(an, "WEM")).toBe("Production");
    expect(toneOf(an, "WEM")).toBe("PROD");
    expect(toneOf(sofia, "EAS")).toBe("lead");
  });
});

describe("names", () => {
  it("takes initials from the first two words and skips a bracketed label", () => {
    expect(initials("Minh Nguyen")).toBe("MN");
    expect(initials("FOH staff (demo)")).toBe("FS");
    expect(initials("Minh")).toBe("M");
  });
  it("gives the first name", () => {
    expect(firstName("Minh Nguyen (demo)")).toBe("Minh");
    expect(firstName("(demo)")).toBe("(demo)");
  });
});
