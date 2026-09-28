export const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

const KEY_NAMES: Record<string, string> = {
  Space: "Espaço",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
};

/** "Ctrl+Alt+KeyV" → "Ctrl + Alt + V". */
export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => {
      if (part === "Super") return "Win";
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit\d$/.test(part)) return part.slice(5);
      if (/^Numpad\d$/.test(part)) return `Num ${part.slice(6)}`;
      return KEY_NAMES[part] ?? part;
    })
    .join(" + ");
}

/** A keydown → "Ctrl+Alt+KeyV" (global-hotkey's format, using `e.code` so
 * it's the physical key regardless of keyboard layout). Null while only
 * modifiers are held, or for a combination without any modifier (which
 * would steal a plain key from every program) — F-keys excepted. */
export function comboFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    Boolean,
  ) as string[];
  const isFunctionKey = /^F\d{1,2}$/.test(e.code);
  if (mods.length === 0 && !isFunctionKey) return null;
  return [...mods, e.code].join("+");
}
