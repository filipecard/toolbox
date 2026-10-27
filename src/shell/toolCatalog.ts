import type { ComponentType } from "react";

/** Props every tool window receives. */
export interface ToolWindowProps {
  toolId: string;
}

export interface ToolCatalogEntry {
  toolId: string;
  /** Emoji fallback, used when there's no `iconSrc`. */
  icon: string;
  /** Default SVG icon (served from `public/`). */
  iconSrc?: string;
  /** `iconSrc` is a single-color (black) glyph — recolored white so it
   * reads on the colored circle. Full-color SVGs are drawn as-is. */
  iconMono?: boolean;
  color: string;
  defaultLabel: string;
  /** One line for Settings → Ferramentas. */
  description: string;
  /** Lazily loads the tool's window component. Each tool lives in its own
   * chunk, so a window only downloads/parses its own code — the bubble and
   * quick menu (always running) never load any tool. Absent for tools that
   * don't open a tool window (notes opens the notes bar instead). */
  load?: () => Promise<{ default: ComponentType<ToolWindowProps> }>;
}

/** Every tool that can appear in the quick menu. Adding a tool here (with
 * its `load`) is all it takes to make its window openable. */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { toolId: "calculator", icon: "🧮", iconSrc: "/calculator.svg", color: "#ada800", defaultLabel: "Calculadora", description: "Contas rápidas com variáveis e histórico",
    load: () => import("../tools/calculator/CalculatorWindow").then((m) => ({ default: m.CalculatorWindow })) },
  { toolId: "notes", icon: "📝", iconSrc: "/notes.svg", color: "#6e5ba4", defaultLabel: "Notas", description: "Anotações rápidas sempre à mão" },
  { toolId: "ocr", icon: "🖼️", iconSrc: "/image-photo.svg", color: "#4f8fd9", defaultLabel: "Leitor de imagem", description: "Extrai o texto de imagens e prints",
    load: () => import("../tools/ocr/OcrWindow").then((m) => ({ default: m.OcrWindow })) },
  { toolId: "color-picker", icon: "🎨", iconSrc: "/palette-paint.svg", color: "#000000", defaultLabel: "Seletor de cor", description: "Captura a cor de qualquer ponto da tela",
    load: () => import("../tools/color-picker/ColorPickerWindow").then((m) => ({ default: m.ColorPickerWindow })) },
  { toolId: "converter", icon: "🔄", iconSrc: "/money-exchange.svg", color: "#0a314d", defaultLabel: "Conversor", description: "Moedas, medidas e unidades",
    load: () => import("../tools/converter/ConverterWindow").then((m) => ({ default: m.ConverterWindow })) },
  { toolId: "clipboard", icon: "📋", iconSrc: "/clipboard.svg", color: "#483d3d", defaultLabel: "Clipboard", description: "Histórico do que você copia e textos prontos",
    load: () => import("../tools/clipboard/ClipboardWindow").then((m) => ({ default: m.ClipboardWindow })) },
  { toolId: "devtools", icon: "🛠️", iconSrc: "/dev-tools.svg", iconMono: true, color: "#993871", defaultLabel: "Utilitários", description: "Formatadores, codificadores e geradores",
    load: () => import("../tools/devtools/DevToolsWindow").then((m) => ({ default: m.DevToolsWindow })) },
  { toolId: "compressor", icon: "🗜️", iconSrc: "/minimize-size.svg", iconMono: true, color: "#0ea5e9", defaultLabel: "Compressor", description: "Diminui o tamanho de imagens e PDFs",
    load: () => import("../tools/compressor/CompressorWindow").then((m) => ({ default: m.CompressorWindow })) },
  { toolId: "translator", icon: "🌐", iconSrc: "/translate.svg", color: "#ffb10a", defaultLabel: "Tradutor", description: "Traduz textos entre idiomas",
    load: () => import("../tools/translator/TranslatorWindow").then((m) => ({ default: m.TranslatorWindow })) },
  { toolId: "transcribe", icon: "🎙️", color: "#c70021", defaultLabel: "Transcrição de áudio", description: "Transforma áudio em texto, no seu computador",
    load: () => import("../tools/transcribe/TranscribeWindow").then((m) => ({ default: m.TranscribeWindow })) },
  { toolId: "reminders", icon: "⏰", iconSrc: "/clocks.svg", color: "#66ac53", defaultLabel: "Lembretes/Timer", description: "Lembretes e timers com aviso na tela",
    load: () => import("../tools/reminders/RemindersWindow").then((m) => ({ default: m.RemindersWindow })) },
  { toolId: "file-search", icon: "🔍", iconSrc: "/search.svg", color: "#14b8a6", defaultLabel: "Busca de arquivos", description: "Encontra arquivos do computador na hora",
    load: () => import("../tools/file-search/FileSearchWindow").then((m) => ({ default: m.FileSearchWindow })) },
];

/** Fixed (non-catalog) icons: the quick menu's settings gear and the
 * launcher bubble. Both single-color glyphs, drawn white. */
export const SETTINGS_ICON_SRC = "/setting.svg";
export const LAUNCHER_ICON_SRC = "/menu.svg";
