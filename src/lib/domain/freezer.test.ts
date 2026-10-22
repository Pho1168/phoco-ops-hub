import { describe, expect, it } from "vitest";
import { classifyReading, freezerShown, freezerValue, parseReading } from "./temperature";

const Z = { code: "Z", label: "Freezer", targetMax: -18, legalMax: -15 } as never;

describe("freezer readings typed without the minus sign", () => {
  it("saves the number below zero, whatever sign was typed", () => {
    expect(freezerValue("18", false)).toBe("-18");
    expect(freezerValue("-20", false)).toBe("-20");
    expect(freezerValue("−19.5", false)).toBe("-19.5");
    expect(freezerValue("18,5", false)).toBe("-18.5");
    expect(freezerValue("0", false)).toBe("0");
    expect(freezerValue("", false)).toBe("");
    expect(freezerValue("abc", false)).toBe("abc"); // refused later, as before
  });
  it("a freezer that really is above zero is recorded with the sign switched", () => {
    expect(freezerValue("4", true)).toBe("4");
    expect(freezerShown("4")).toEqual({ digits: "4", above: true });
    expect(freezerShown("-18")).toEqual({ digits: "18", above: false });
  });
  it("so a slip like 20 no longer raises an alert", () => {
    expect(classifyReading(parseReading(freezerValue("20", false)), Z)).toBe("ok");
    expect(classifyReading(parseReading(freezerValue("12", false)), Z)).toBe("bad");
  });
});
