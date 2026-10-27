import { invoke } from "@tauri-apps/api/core";
import { THEME_PRESETS, getSettings, saveSettings } from "./settingsStore";

interface InstallerSetup {
  version: number;
  /** Tool ids to install (and show in the quick menu); the rest stay
   * available in Settings → Ferramentas. */
  tools?: string[];
  /** A THEME_PRESETS id. */
  theme?: string;
  autostart?: boolean;
}

/** First start after installing: applies what the installer asked (which
 * tools are installed, theme colors). Rust hands the file over only once. */
export async function applyInstallerSetup(): Promise<void> {
  const setup = await invoke<InstallerSetup | null>("take_installer_setup");
  if (!setup) return;
  const settings = await getSettings();
  const tools = Array.isArray(setup.tools) && setup.tools.length ? setup.tools : null;
  const preset = THEME_PRESETS.find((p) => p.id === setup.theme);
  await saveSettings({
    ...settings,
    quickMenuItems: tools
      ? settings.quickMenuItems.map((item) => {
          const chosen = tools.includes(item.toolId);
          return { ...item, enabled: chosen, installed: chosen };
        })
      : settings.quickMenuItems,
    theme: preset ? { ...settings.theme, ...preset.colors } : settings.theme,
  });
}
