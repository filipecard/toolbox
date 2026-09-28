import { describe, expect, it } from "vitest";
import { UNIT_CATEGORIES, convert } from "./units";

const cat = (id: string) => UNIT_CATEGORIES.find((c) => c.id === id)!;

describe("convert", () => {
  it("converts length", () => {
    expect(convert(cat("length"), "km", "m", 1.5)).toBeCloseTo(1500);
    expect(convert(cat("length"), "mi", "km", 1)).toBeCloseTo(1.609344);
  });

  it("converts temperature (non-linear offsets)", () => {
    expect(convert(cat("temperature"), "c", "f", 100)).toBeCloseTo(212);
    expect(convert(cat("temperature"), "f", "c", 32)).toBeCloseTo(0);
    expect(convert(cat("temperature"), "c", "k", 0)).toBeCloseTo(273.15);
  });

  it("round-trips every unit in every category", () => {
    for (const category of UNIT_CATEGORIES) {
      const base = category.units[0].id;
      for (const u of category.units) {
        const there = convert(category, base, u.id, 42);
        expect(convert(category, u.id, base, there)).toBeCloseTo(42, 6);
      }
    }
  });

  it("returns NaN for unknown units", () => {
    expect(convert(cat("length"), "m", "parsec", 1)).toBeNaN();
  });
});
