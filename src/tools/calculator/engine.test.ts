import { describe, expect, it } from "vitest";
import { buildVariableScope, evaluateExpression } from "./engine";

describe("evaluateExpression", () => {
  it("follows operator precedence", () => {
    expect(evaluateExpression("2 + 3 * 4", {})).toBe("14");
    expect(evaluateExpression("(2 + 3) * 4", {})).toBe("20");
  });

  it("rounds away float noise", () => {
    expect(evaluateExpression("0.1 + 0.2", {})).toBe("0.3");
  });

  it("supports the scientific functions", () => {
    expect(evaluateExpression("sqrt(16)", {})).toBe("4");
    expect(evaluateExpression("log10(1000)", {})).toBe("3");
    expect(evaluateExpression("2 ^ 10", {})).toBe("1024");
  });

  it("reads variables from the scope", () => {
    expect(evaluateExpression("x * 2", { x: 21 })).toBe("42");
  });

  it("returns Erro instead of throwing", () => {
    expect(evaluateExpression("2 +", {})).toBe("Erro");
    expect(evaluateExpression("1 / 0", {})).toBe("Erro");
    expect(evaluateExpression("undefinedName + 1", {})).toBe("Erro");
  });

  it("returns empty for blank input", () => {
    expect(evaluateExpression("   ", {})).toBe("");
  });
});

describe("buildVariableScope", () => {
  it("lets a variable use the ones above it and memory", () => {
    const { scope, results } = buildVariableScope(
      [
        { id: "a", name: "a", expr: "2" },
        { id: "b", name: "b", expr: "a * M" },
      ],
      5,
    );
    expect(scope.b).toBe(10);
    expect(results.b).toEqual({ value: 10, error: false });
  });

  it("forbids forward references", () => {
    const { results } = buildVariableScope(
      [
        { id: "a", name: "a", expr: "b + 1" },
        { id: "b", name: "b", expr: "1" },
      ],
      0,
    );
    expect(results.a.error).toBe(true);
    expect(results.b.error).toBe(false);
  });
});
