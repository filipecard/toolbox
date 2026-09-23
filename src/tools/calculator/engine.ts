import {
  create,
  evaluateDependencies,
  sqrtDependencies,
  sinDependencies,
  cosDependencies,
  tanDependencies,
  logDependencies,
  log10Dependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  unaryMinusDependencies,
} from "mathjs/number";

// Curated bundle instead of `create(all, {})`: pulls in only the plain-number
// evaluator + the functions the keypad actually exposes, so every calculator
// window doesn't instantiate mathjs's full bignumber/complex/matrix graph.
const math = create(
  {
    evaluateDependencies,
    sqrtDependencies,
    sinDependencies,
    cosDependencies,
    tanDependencies,
    logDependencies,
    log10Dependencies,
    addDependencies,
    subtractDependencies,
    multiplyDependencies,
    divideDependencies,
    powDependencies,
    unaryMinusDependencies,
  },
  {},
);

export interface Variable {
  id: string;
  name: string;
  expr: string;
}

export interface VariableResult {
  value?: number;
  error: boolean;
}

function formatResult(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Erro";
    const rounded = Number(value.toPrecision(12));
    return rounded.toString();
  }
  if (typeof value === "boolean") return value.toString();
  return String(value);
}

export function evaluateExpression(expr: string, scope: Record<string, unknown>): string {
  if (!expr.trim()) return "";
  try {
    const value = math.evaluate(expr, { ...scope });
    return formatResult(value);
  } catch {
    return "Erro";
  }
}

/**
 * Evaluates variables in list order, each against a scope built only from the
 * variables before it (so a variable can never see one defined below it —
 * no forward references, no recursion).
 */
export function buildVariableScope(
  variables: Variable[],
  memory: number,
): { scope: Record<string, number>; results: Record<string, VariableResult> } {
  const scope: Record<string, number> = { M: memory };
  const results: Record<string, VariableResult> = {};

  for (const v of variables) {
    if (!v.expr.trim()) {
      results[v.id] = { error: false };
      continue;
    }
    try {
      const value = math.evaluate(v.expr, { ...scope });
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("not a number");
      }
      results[v.id] = { value, error: false };
      scope[v.name] = value;
    } catch {
      results[v.id] = { error: true };
    }
  }

  return { scope, results };
}
