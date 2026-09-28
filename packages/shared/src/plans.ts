/** Plan tiers and their limits — mirror of src-tauri/src/plans.rs, which
 * enforces them in the desktop app. A server test (plans-sync.test.ts)
 * fails if the two tables drift apart. */
export type Tier = "free" | "basic" | "silver" | "gold";
/** A paid tier a subscription can grant ("diamond" = every tool, no limits). */
export type PaidTier = "basic" | "silver" | "gold" | "diamond";

export const TIERS: { id: Tier; label: string }[] = [
  { id: "free", label: "Grátis" },
  { id: "basic", label: "Básico" },
  { id: "silver", label: "Prata" },
  { id: "gold", label: "Gold" },
];

export const PAID_TIER_LABELS: Record<PaidTier, string> = {
  basic: "Básico",
  silver: "Prata",
  gold: "Gold",
  diamond: "Diamante",
};

export interface FeatureLimit {
  id: string;
  tool: string;
  label: string;
  /** Counted per day (resets at local midnight) vs. a standing cap. */
  daily: boolean;
  /** Grátis, Básico, Prata, Gold. Diamante is always unlimited. */
  limits: [number, number, number, number];
}

export const FEATURE_LIMITS: FeatureLimit[] = [
  { id: "ocrDaily", tool: "ocr", label: "Imagens lidas por dia", daily: true, limits: [2, 20, 60, 200] },
  {
    id: "compressorDaily",
    tool: "compressor",
    label: "Arquivos comprimidos por dia",
    daily: true,
    limits: [5, 50, 200, 1000],
  },
  { id: "transcribeDaily", tool: "transcribe", label: "Transcrições por dia", daily: true, limits: [2, 15, 50, 150] },
  {
    id: "transcribeFileMb",
    tool: "transcribe",
    label: "Tamanho máximo do áudio (MB)",
    daily: false,
    limits: [10, 25, 50, 100],
  },
  { id: "clipboardHistory", tool: "clipboard", label: "Itens no histórico", daily: false, limits: [5, 50, 200, 1000] },
  {
    id: "clipboardPinned",
    tool: "clipboard",
    label: "Fixados e textos prontos",
    daily: false,
    limits: [3, 20, 100, 500],
  },
  {
    id: "fileSearchResults",
    tool: "file-search",
    label: "Resultados por busca",
    daily: false,
    limits: [100, 500, 2000, 10000],
  },
  { id: "calcVariables", tool: "calculator", label: "Variáveis", daily: false, limits: [3, 10, 25, 50] },
  {
    id: "harmoniesDaily",
    tool: "color-picker",
    label: "Paletas harmônicas por dia",
    daily: true,
    limits: [3, 30, 100, 300],
  },
  {
    id: "remindersActive",
    tool: "reminders",
    label: "Lembretes agendados ao mesmo tempo",
    daily: false,
    limits: [5, 20, 50, 150],
  },
];
