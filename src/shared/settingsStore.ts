import { load, Store } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { TOOL_CATALOG } from "../shell/toolCatalog";

export interface QuickMenuItemSetting {
  toolId: string;
  label: string;
  enabled: boolean;
  /** Emoji override for this item's icon. Ignored when `iconImage` is set. */
  icon?: string;
  /** Custom uploaded icon, pre-cropped to a circle, as a PNG data URL. Takes
   * priority over `icon` when present. */
  iconImage?: string;
  /** Background color (hex) override for this item's circle. Falls back to
   * the catalog's default color when unset. */
  color?: string;
}

/** A small base palette (terminal-color-scheme style) that every window's
 * chrome derives from, instead of independent per-element color settings. */
export interface AppTheme {
  background: string;
  /** Panel background opacity, from 0 (invisible) to 1 (fully opaque). Panel
   * windows are OS-transparent, so lowering this reveals the desktop. */
  backgroundOpacity: number;
  text: string;
  textOpacity: number;
  /** Close-window button hover / primary destructive highlight. */
  accent: string;
  accentOpacity: number;
  /** Title bar background. */
  header: string;
  headerOpacity: number;
  /** Default background for generic buttons (keypad keys, list action buttons). */
  button: string;
  buttonOpacity: number;
  /** Background of text fields, search boxes and text areas. */
  input: string;
  inputOpacity: number;
  /** Multiplies the whole UI's size (fonts, spacing, controls) via CSS zoom. */
  fontScale: number;
  /** Font family used everywhere text renders, picked from fonts installed
   * on this computer (see list_system_fonts). */
  fontFamily: string;
  /** Multiplies just text size, independent of `fontScale`'s full-UI zoom. */
  fontSizeScale: number;
}

export interface AppSettings {
  quickMenuItems: QuickMenuItemSetting[];
  /** Launcher bubble diameter in logical pixels. */
  bubbleSize: number;
  /** Launcher bubble background color (hex). */
  bubbleColor: string;
  /** Launcher bubble opacity, from 0 (invisible) to 1 (fully opaque). */
  bubbleOpacity: number;
  theme: AppTheme;
  /** One user-saved theme slot (full theme: colors, opacities, font and
   * sizes), re-applied from its tile in Settings. Unset until first saved. */
  customTheme?: AppTheme;
}

export const DEFAULT_BUBBLE_SIZE = 44;
export const DEFAULT_BUBBLE_COLOR = "#008f32";
export const DEFAULT_BUBBLE_OPACITY = 0.8;

export const DEFAULT_THEME: AppTheme = {
  background: "#000000",
  backgroundOpacity: 1,
  text: "#ffffff",
  textOpacity: 1,
  accent: "#d70909",
  accentOpacity: 1,
  header: "#171716",
  headerOpacity: 1,
  button: "#174e59",
  buttonOpacity: 1,
  input: "#24262c",
  inputOpacity: 1,
  fontScale: 1,
  fontFamily: "Segoe UI",
  fontSizeScale: 1.1,
};

/** Just the colors of a theme — presets swap these and leave the user's
 * font, sizes and opacities alone. */
export type ThemeColors = Pick<AppTheme, "background" | "text" | "accent" | "header" | "button" | "input">;

export const THEME_PRESETS: { id: string; label: string; colors: ThemeColors }[] = [
  {
    id: "default",
    label: "Padrão",
    colors: {
      background: DEFAULT_THEME.background,
      text: DEFAULT_THEME.text,
      accent: DEFAULT_THEME.accent,
      header: DEFAULT_THEME.header,
      button: DEFAULT_THEME.button,
      input: DEFAULT_THEME.input,
    },
  },
  {
    id: "dark",
    label: "Escuro",
    colors: { background: "#1e1f24", text: "#f2f2f2", accent: "#d94f4f", header: "#16171b", button: "#2b2d33", input: "#24262c" },
  },
  {
    id: "light",
    label: "Claro",
    colors: { background: "#f4f5f7", text: "#1f2328", accent: "#d73a49", header: "#e2e5e9", button: "#d9dee4", input: "#ffffff" },
  },
  {
    id: "contrast",
    label: "Alto contraste",
    colors: { background: "#000000", text: "#ffff00", accent: "#ff3b3b", header: "#000000", button: "#1f1f1f", input: "#000000" },
  },
  {
    id: "ocean",
    label: "Oceano",
    colors: { background: "#0f2a3d", text: "#e6f4ff", accent: "#ff7a59", header: "#0a1f2e", button: "#1b4965", input: "#143650" },
  },
  {
    id: "sunset",
    label: "Pôr do sol",
    colors: { background: "#2d1b3d", text: "#ffe8d6", accent: "#ff6b6b", header: "#1f1230", button: "#5a2d5c", input: "#3a2450" },
  },
  {
    id: "forest",
    label: "Floresta",
    colors: { background: "#1b2a1f", text: "#e8f5e9", accent: "#f4a261", header: "#13201a", button: "#2d4a35", input: "#22382a" },
  },
  {
    id: "candy",
    label: "Pastel",
    colors: { background: "#fff4f8", text: "#4a2c40", accent: "#e0457b", header: "#ffd9e6", button: "#f7c8dc", input: "#ffffff" },
  },
];

const SETTINGS_KEY = "settings";
const SETTINGS_CHANGED_EVENT = "settings-changed";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("store.json", { autoSave: false });
  }
  return storePromise;
}

function defaultSettings(): AppSettings {
  return {
    quickMenuItems: TOOL_CATALOG.map((t) => ({
      toolId: t.toolId,
      label: t.defaultLabel,
      enabled: true,
    })),
    bubbleSize: DEFAULT_BUBBLE_SIZE,
    bubbleColor: DEFAULT_BUBBLE_COLOR,
    bubbleOpacity: DEFAULT_BUBBLE_OPACITY,
    theme: DEFAULT_THEME,
  };
}

/** Merges stored settings with the catalog: new tools added to the catalog
 * later show up appended (enabled), and stored customizations win otherwise. */
function normalize(stored: Partial<AppSettings> | null): AppSettings {
  const base = defaultSettings();
  if (!stored) return base;

  const storedItems = stored.quickMenuItems ?? [];
  const knownIds = new Set(storedItems.map((i) => i.toolId));
  const missing = base.quickMenuItems.filter((i) => !knownIds.has(i.toolId));

  return {
    quickMenuItems: [...storedItems, ...missing],
    bubbleSize: stored.bubbleSize ?? base.bubbleSize,
    bubbleColor: stored.bubbleColor ?? base.bubbleColor,
    bubbleOpacity: stored.bubbleOpacity ?? base.bubbleOpacity,
    theme: { ...base.theme, ...stored.theme },
    customTheme: stored.customTheme ? { ...base.theme, ...stored.customTheme } : undefined,
  };
}

/** Resets every visual customization (icon colors, bubble, theme) back to
 * the fixed defaults, keeping the quick-menu's order, labels, enabled
 * toggles and custom icon images. */
export function withVisualDefaults(settings: AppSettings): AppSettings {
  return {
    ...settings,
    quickMenuItems: settings.quickMenuItems.map(({ color: _color, ...rest }) => rest),
    bubbleSize: DEFAULT_BUBBLE_SIZE,
    bubbleColor: DEFAULT_BUBBLE_COLOR,
    bubbleOpacity: DEFAULT_BUBBLE_OPACITY,
    theme: DEFAULT_THEME,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const store = await getStore();
  const stored = await store.get<Partial<AppSettings>>(SETTINGS_KEY);
  const normalized = normalize(stored ?? null);

  // Self-heals store.json whenever the catalog has grown since the last
  // save: `normalize` only merges new tools in *in memory*, so without
  // this, the persisted quickMenuItems list silently falls behind every
  // time a new tool ships, until the user happens to trigger a save some
  // other way (toggling a checkbox, etc.). That stale persisted list is a
  // real problem beyond just this function's own callers — the Rust side
  // (windows.rs's quick_menu_item_count) reads the raw persisted list
  // directly to size the quick-menu bar's window, so a stale list there
  // undercounts icons and clips the bar short.
  const storedIds = new Set((stored?.quickMenuItems ?? []).map((i) => i.toolId));
  const hasNewItems = normalized.quickMenuItems.some((i) => !storedIds.has(i.toolId));
  if (!stored || hasNewItems) {
    await saveSettings(normalized);
  }

  return normalized;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getStore();
  await store.set(SETTINGS_KEY, settings);
  await store.save();
  await emit(SETTINGS_CHANGED_EVENT, null);
}

export function onSettingsChanged(handler: () => void): Promise<() => void> {
  return listen(SETTINGS_CHANGED_EVENT, handler);
}
