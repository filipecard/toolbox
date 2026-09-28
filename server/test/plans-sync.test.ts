// The limits table exists twice: TypeScript (website/API, packages/shared)
// and Rust (the desktop app, which enforces it). This fails if they drift.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_LIMITS, TOOLS } from "@toolbox/shared";

const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/plans.rs"), "utf8");
const catalog = readFileSync(resolve(__dirname, "../../src/shell/toolCatalog.ts"), "utf8");

describe("plans table", () => {
  it("matches src-tauri/src/plans.rs", () => {
    const rustFeatures = [...rust.matchAll(/\(\s*"(\w+)",\s*"([\w-]+)",\s*"[^"]*",\s*(true|false),\s*\[([\d,\s]+)\]\s*\)/g)].map(
      (m) => ({ id: m[1], tool: m[2], daily: m[3] === "true", limits: m[4].split(",").map((n: string) => Number(n.trim())) }),
    );
    expect(rustFeatures.length).toBe(FEATURE_LIMITS.length);
    for (const f of FEATURE_LIMITS) {
      expect(rustFeatures.find((r) => r.id === f.id), f.id).toEqual({
        id: f.id,
        tool: f.tool,
        daily: f.daily,
        limits: f.limits,
      });
    }
  });

  it("every limited tool is a paid tool", () => {
    for (const f of FEATURE_LIMITS) expect(TOOLS.find((t) => t.id === f.tool)?.paid, f.tool).toBe(true);
  });

  it("tool ids match the desktop catalog", () => {
    const desktopIds = [...catalog.matchAll(/toolId: "([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(desktopIds).toEqual(TOOLS.map((t) => t.id).sort());
  });
});
