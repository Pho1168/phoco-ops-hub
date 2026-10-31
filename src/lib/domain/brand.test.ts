import { describe, expect, it } from "vitest";
import { BRANDS, brandCss, brandLabel, brandOf, brandPrefix, brandSlug, brandsOf, inBrand } from "./brand";

const sites = [{ id: "EAS", brand: "phoco" as const }, { id: "WEM" }, { id: "CLV", brand: "clv" as const }];

describe("brands", () => {
  it("a site trades as PHO & CO unless it says otherwise", () => {
    expect(brandOf(sites[1]).name).toBe("PHO & CO");
    expect(brandOf(sites[2]).name).toBe("Cafe La Viet");
    expect(brandOf(undefined).id).toBe("phoco");
  });
  it("names a list by its businesses", () => {
    expect(brandsOf(sites).map((b) => b.id)).toEqual(["phoco", "clv"]);
    expect(brandLabel([sites[2]])).toBe("Cafe La Viet");
    expect(brandPrefix([sites[2]])).toBe("Cafe La Viet ");
    expect(brandPrefix(sites)).toBe("");
    expect(brandSlug([sites[0]])).toBe("PHO-CO");
  });
  it("puts someone at both businesses on both staff lists", () => {
    const both = { access: [{ siteId: "EAS" }, { siteId: "CLV" }] };
    const clv = { access: [{ siteId: "CLV" }] };
    expect(inBrand(both, "phoco", sites) && inBrand(both, "clv", sites)).toBe(true);
    expect(inBrand(clv, "phoco", sites)).toBe(false);
  });
  it("only swaps colours a brand has, and only real hex", () => {
    expect(brandCss(BRANDS.phoco)).toBe("");
    expect(brandCss({ id: "clv", name: "x", colours: { brand: "#123456", teal: "red;}" } })).toBe(":root{--brand:#123456}");
  });
});
