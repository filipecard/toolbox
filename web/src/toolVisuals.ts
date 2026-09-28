/** How each tool looks — the same circle color and icon as the desktop
 * app's quick menu (src/shell/toolCatalog.ts), so the site shows the real
 * thing people will see on their desktop. */
export interface ToolVisual {
  color: string;
  icon: string;
  /** Single-color black glyph, drawn white on its circle. */
  mono?: boolean;
  /** Emoji fallback when there's no SVG. */
  emoji?: string;
}

export const TOOL_VISUALS: Record<string, ToolVisual> = {
  calculator: { color: "#ada800", icon: "/icons/calculator.svg" },
  notes: { color: "#6e5ba4", icon: "/icons/notes.svg" },
  ocr: { color: "#4f8fd9", icon: "/icons/image-photo.svg" },
  "color-picker": { color: "#1b1b1b", icon: "/icons/palette-paint.svg" },
  converter: { color: "#0a314d", icon: "/icons/money-exchange.svg" },
  clipboard: { color: "#483d3d", icon: "/icons/clipboard.svg" },
  devtools: { color: "#993871", icon: "/icons/dev-tools.svg", mono: true },
  compressor: { color: "#0ea5e9", icon: "/icons/minimize-size.svg", mono: true },
  translator: { color: "#ffb10a", icon: "/icons/translate.svg" },
  transcribe: { color: "#c70021", icon: "", emoji: "🎙️" },
  reminders: { color: "#66ac53", icon: "/icons/clocks.svg" },
  "file-search": { color: "#14b8a6", icon: "/icons/search.svg" },
};
