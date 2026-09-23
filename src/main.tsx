import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveRole } from "./bootstrap/resolveRole";
import { Bubble } from "./shell/Bubble";
import { QuickMenu } from "./shell/QuickMenu";
import { SettingsWindow } from "./shell/SettingsWindow";
import { CalculatorWindow } from "./tools/calculator/CalculatorWindow";
import { NotesBar } from "./tools/notepad/NotesBar";
import { NoteEditor } from "./tools/notepad/NoteEditor";
import { OcrWindow } from "./tools/ocr/OcrWindow";
import { ColorPickerWindow } from "./tools/color-picker/ColorPickerWindow";
import { ConverterWindow } from "./tools/converter/ConverterWindow";
import { ClipboardWindow } from "./tools/clipboard/ClipboardWindow";
import { DevToolsWindow } from "./tools/devtools/DevToolsWindow";
import { CompressorWindow } from "./tools/compressor/CompressorWindow";
import { TranslatorWindow } from "./tools/translator/TranslatorWindow";
import { TranscribeWindow } from "./tools/transcribe/TranscribeWindow";
import { RemindersWindow } from "./tools/reminders/RemindersWindow";
import { FileSearchWindow } from "./tools/file-search/FileSearchWindow";
import { getSettings, onSettingsChanged } from "./shared/settingsStore";
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
const applyTheme = () =>
  void getSettings().then((s) => {
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
  });
applyTheme();
void onSettingsChanged(applyTheme);

function Root() {
  switch (role.kind) {
    case "bubble":
      return <Bubble toolId={role.toolId} />;
    case "quick-menu":
      return <QuickMenu />;
    case "tool":
      if (role.toolId === "settings") return <SettingsWindow />;
      if (role.toolId === "ocr") return <OcrWindow toolId={role.toolId} />;
      if (role.toolId === "color-picker") return <ColorPickerWindow toolId={role.toolId} />;
      if (role.toolId === "converter") return <ConverterWindow toolId={role.toolId} />;
      if (role.toolId === "clipboard") return <ClipboardWindow toolId={role.toolId} />;
      if (role.toolId === "devtools") return <DevToolsWindow toolId={role.toolId} />;
      if (role.toolId === "compressor") return <CompressorWindow toolId={role.toolId} />;
      if (role.toolId === "translator") return <TranslatorWindow toolId={role.toolId} />;
      if (role.toolId === "transcribe") return <TranscribeWindow toolId={role.toolId} />;
      if (role.toolId === "reminders") return <RemindersWindow toolId={role.toolId} />;
      if (role.toolId === "file-search") return <FileSearchWindow toolId={role.toolId} />;
      return <CalculatorWindow toolId={role.toolId} />;
    case "notes-bar":
      return <NotesBar />;
    case "note":
      return <NoteEditor noteId={role.noteId} />;
    default:
      return <div>Janela desconhecida: {role.label}</div>;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
