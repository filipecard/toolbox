import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Quota } from "./tauri";

/** Mirrors plans.rs — the Rust side is the source of truth for every limit;
 * this file only reads and displays them. */
export type Tier = "free" | "basic" | "silver" | "gold";

export const TIERS: { id: Tier; label: string }[] = [
  { id: "free", label: "Grátis" },
  { id: "basic", label: "Básico" },
  { id: "silver", label: "Prata" },
  { id: "gold", label: "Gold" },
];

export type FeatureId =
  | "ocrDaily"
  | "compressorDaily"
  | "transcribeDaily"
  | "transcribeFileMb"
  | "clipboardHistory"
  | "clipboardPinned"
  | "fileSearchResults"
  | "calcVariables"
  | "harmoniesDaily"
  | "remindersActive";

export interface PlanStatus {
  diamond: boolean;
  tools: Partial<Record<string, Tier>>;
  /** Current limit per feature; `null` = unlimited. */
  limits: Record<FeatureId, number | null>;
}

const PLAN_CHANGED_EVENT = "plan-changed";

export function planStatus(): Promise<PlanStatus> {
  return invoke("plan_status");
}

export function onPlanChanged(handler: () => void): Promise<() => void> {
  return listen(PLAN_CHANGED_EVENT, handler);
}

/** The display name of the plan currently applying to `tool`. */
export function planLabel(status: PlanStatus, tool: string): string {
  if (status.diamond) return "Diamante";
  const tier = status.tools[tool] ?? "free";
  return TIERS.find((t) => t.id === tier)!.label;
}

/** Live plan status; re-fetches whenever the plan changes in any window. */
export function usePlanStatus(): PlanStatus | null {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  useEffect(() => {
    const refresh = () => void planStatus().then(setStatus);
    refresh();
    const unlisten = onPlanChanged(refresh);
    return () => void unlisten.then((f) => f());
  }, []);
  return status;
}

/** Live quota for a daily feature, refreshed on plan changes. The setter
 * lets a tool apply the fresh quota a consuming command returns. */
export function useQuota(feature: FeatureId): [Quota | null, (q: Quota) => void] {
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => {
    const refresh = () => void invoke<Quota>("feature_quota", { feature }).then(setQuota);
    refresh();
    const unlisten = onPlanChanged(refresh);
    return () => void unlisten.then((f) => f());
  }, [feature]);
  return [quota, setQuota];
}

export function isQuotaExceeded(quota: Quota | null): boolean {
  return !!quota && quota.limit !== null && quota.used >= quota.limit;
}

/** "Plano Grátis: 1/2 hoje" / "Plano Diamante: ilimitado". */
export function formatQuota(quota: Quota, unit = "hoje"): string {
  if (quota.limit === null) return `Plano ${quota.plan}: ilimitado`;
  return `Plano ${quota.plan}: ${quota.used}/${quota.limit} ${unit}`;
}

export function formatLimit(limit: number | null): string {
  return limit === null ? "ilimitado" : limit.toLocaleString("pt-BR");
}
