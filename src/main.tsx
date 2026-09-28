import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveRole } from "./bootstrap/resolveRole";
import { Bubble } from "./shell/Bubble";
import { QuickMenu } from "./shell/QuickMenu";
import { TOOL_CATALOG } from "./shell/toolCatalog";
import { getSettings, onSettingsChanged, type AppSettings } from "./shared/settingsStore";
import "./App.css";

const label = getCurrentWindow().label;
const role = resolveRole(label);
document.documentElement.dataset.role = role.kind;
document.body.dataset.role = role.kind;

/** Turns a "#rrggbb" color plus an opacity (0-1) into an "rgba(...)" string.
 * Panel windows are created OS-transparent, so painting these as the CSS
 * background is what actually lets the desktop show through at low opacity
 * (not just a flat CSS `opacity` on the element, which would fade its
 * content too). */
function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Perceived brightness of a "#rrggbb" color, as a light/dark split. */
function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

// Applies to every window (not just panel ones) — harmless no-op for
// bubble/quick-menu, whose background is overridden back to transparent by
// CSS regardless of --theme-bg.
// Every settings save (e.g. each quick-menu checkbox in Settings) reaches
// every window; rewriting the root variables restyles the whole document
// even when the values are the same, so unchanged themes are skipped.
let appliedTheme = "";
const applyTheme = (s: AppSettings) => {
  const key = JSON.stringify(s.theme);
  if (key === appliedTheme) return;
  appliedTheme = key;
  const root = document.documentElement.style;
  root.setProperty("--theme-bg", hexToRgba(s.theme.background, s.theme.backgroundOpacity));
  root.setProperty("--theme-text", hexToRgba(s.theme.text, s.theme.textOpacity));
  root.setProperty("--theme-accent", hexToRgba(s.theme.accent, s.theme.accentOpacity));
  root.setProperty("--theme-header", hexToRgba(s.theme.header, s.theme.headerOpacity));
  root.setProperty("--theme-button", hexToRgba(s.theme.button, s.theme.buttonOpacity));
  root.setProperty("--theme-input", hexToRgba(s.theme.input, s.theme.inputOpacity));
  // Opaque variant for floating surfaces (dropdowns, dialogs) that must
  // stay readable even when the panel itself is see-through.
  root.setProperty("--theme-bg-solid", s.theme.background);
  // Native bits (scrollbars, <select> popups, checkboxes) follow this, so
  // a light theme needs them light too instead of dark-on-light.
  root.colorScheme = isLight(s.theme.background) ? "light" : "dark";
  root.setProperty("--ui-zoom", String(s.theme.fontScale));
  root.setProperty("--theme-font-family", `"${s.theme.fontFamily}", system-ui, sans-serif`);
  root.setProperty("--theme-font-scale", String(s.theme.fontSizeScale));
};
void getSettings().then(applyTheme);
void onSettingsChanged(applyTheme);

// Everything but the always-running bubble and quick menu is split into
// its own chunk and loaded only by the window that shows it — see
// toolCatalog.ts's `load`.
const SettingsWindow = lazy(() =>
  import("./shell/SettingsWindow").then((m) => ({ default: m.SettingsWindow })),
);
const NotesBar = lazy(() => import("./tools/notepad/NotesBar").then((m) => ({ default: m.NotesBar })));
const NoteEditor = lazy(() =>
  import("./tools/notepad/NoteEditor").then((m) => ({ default: m.NoteEditor })),
);
const AccountWindow = lazy(() =>
  import("./shell/AccountWindow").then((m) => ({ default: m.AccountWindow })),
);
const toolWindows = new Map(
  TOOL_CATALOG.filter((t) => t.load).map((t) => [t.toolId, lazy(t.load!)]),
);

function Root() {
  switch (role.kind) {
    case "bubble":
      return <Bubble toolId={role.toolId} />;
    case "quick-menu":
      return <QuickMenu />;
    case "tool": {
      if (role.toolId === "settings") return <SettingsWindow />;
      const ToolWindow = toolWindows.get(role.toolId);
      if (!ToolWindow) return <div>Ferramenta desconhecida: {role.toolId}</div>;
      return <ToolWindow toolId={role.toolId} />;
    }
    case "notes-bar":
      return <NotesBar />;
    case "note":
      return <NoteEditor noteId={role.noteId} />;
    case "account":
      return <AccountWindow />;
    default:
      return <div>Janela desconhecida: {role.label}</div>;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Empty themed panel while the window's chunk loads (a few ms, from
        disk) — same look as the pre-painted background, so no flash. */}
    <Suspense fallback={<div className="panel" />}>
      <Root />
    </Suspense>
  </React.StrictMode>,
);
