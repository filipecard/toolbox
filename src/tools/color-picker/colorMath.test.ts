import { describe, expect, it } from "vitest";
import {
  buildHarmonies,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  isValidHex,
  normalizeHex,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from "./colorMath";

describe("hex parsing", () => {
  it("validates and normalizes", () => {
    expect(isValidHex("#3399ff")).toBe(true);
    expect(isValidHex("#zzzzzz")).toBe(false);
    expect(normalizeHex("3399FF")).toBe("#3399ff");
  });

  it("round-trips through rgb", () => {
    expect(hexToRgb("#3399ff")).toEqual({ r: 51, g: 153, b: 255 });
    expect(rgbToHex({ r: 51, g: 153, b: 255 })).toBe("#3399ff");
  });
});

describe("color space conversions", () => {
  const samples = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#3399ff", "#ada800", "#6e5ba4"];

  it.each(samples)("%s survives rgb → hsl → rgb", (hex) => {
    const rgb = hexToRgb(hex);
    expect(rgbToHex(hslToRgb(rgbToHsl(rgb)))).toBe(hex);
  });

  // HSV is stored as whole numbers (it only drives the picker square), so
  // a round trip can land one step off per channel — but no further.
  it.each(samples)("%s survives rgb → hsv → rgb within 1 step", (hex) => {
    const rgb = hexToRgb(hex);
    const back = hsvToRgb(rgbToHsv(rgb));
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
  });

  it("knows pure red's hsl", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toMatchObject({ h: 0, s: 100, l: 50 });
  });
});

describe("buildHarmonies", () => {
  it("builds a complementary color 180° away", () => {
    const harmonies = buildHarmonies(rgbToHsl({ r: 255, g: 0, b: 0 }));
    expect(harmonies.length).toBeGreaterThan(0);
    const all = harmonies.flatMap((h) => h.hexes);
    expect(all).toContain("#00ffff");
  });
});
