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
}

/** Every tool that can appear in the quick menu. Add future tools here. */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { toolId: "calculator", icon: "🧮", iconSrc: "/calculator.svg", color: "#ada800", defaultLabel: "Calculadora" },
  { toolId: "notes", icon: "📝", iconSrc: "/notes.svg", color: "#6e5ba4", defaultLabel: "Notas" },
  { toolId: "ocr", icon: "🖼️", iconSrc: "/image-photo.svg", color: "#4f8fd9", defaultLabel: "Leitor de imagem" },
  { toolId: "color-picker", icon: "🎨", iconSrc: "/palette-paint.svg", color: "#000000", defaultLabel: "Seletor de cor" },
  { toolId: "converter", icon: "🔄", iconSrc: "/money-exchange.svg", color: "#0a314d", defaultLabel: "Conversor" },
  { toolId: "clipboard", icon: "📋", iconSrc: "/clipboard.svg", color: "#483d3d", defaultLabel: "Clipboard" },
  { toolId: "devtools", icon: "🛠️", iconSrc: "/dev-tools.svg", iconMono: true, color: "#993871", defaultLabel: "Utilitários" },
  { toolId: "compressor", icon: "🗜️", iconSrc: "/minimize-size.svg", iconMono: true, color: "#0ea5e9", defaultLabel: "Compressor" },
  { toolId: "translator", icon: "🌐", iconSrc: "/translate.svg", color: "#ffb10a", defaultLabel: "Tradutor" },
  { toolId: "transcribe", icon: "🎙️", color: "#c70021", defaultLabel: "Transcrição de áudio" },
  { toolId: "reminders", icon: "⏰", iconSrc: "/clocks.svg", color: "#66ac53", defaultLabel: "Lembretes/Timer" },
  { toolId: "file-search", icon: "🔍", iconSrc: "/search.svg", color: "#14b8a6", defaultLabel: "Busca de arquivos" },
];

/** Fixed (non-catalog) icons: the quick menu's settings gear and the
 * launcher bubble. Both single-color glyphs, drawn white. */
export const SETTINGS_ICON_SRC = "/setting.svg";
export const LAUNCHER_ICON_SRC = "/menu.svg";
