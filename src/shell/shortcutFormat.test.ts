import { describe, expect, it } from "vitest";
import { comboFromEvent, formatCombo } from "./shortcutFormat";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("comboFromEvent", () => {
  it("builds global-hotkey strings from physical keys", () => {
    expect(comboFromEvent(key("KeyV", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+KeyV");
    expect(comboFromEvent(key("Digit1", { shiftKey: true, metaKey: true }))).toBe("Shift+Super+Digit1");
  });

  it("waits while only modifiers are held", () => {
    expect(comboFromEvent(key("ControlLeft", { ctrlKey: true }))).toBeNull();
  });

  it("refuses plain keys but allows bare F-keys", () => {
    expect(comboFromEvent(key("KeyA"))).toBeNull();
    expect(comboFromEvent(key("F9"))).toBe("F9");
  });
});

describe("formatCombo", () => {
  it("shows friendly names", () => {
    expect(formatCombo("Ctrl+Alt+KeyV")).toBe("Ctrl + Alt + V");
    expect(formatCombo("Ctrl+Alt+Space")).toBe("Ctrl + Alt + Espaço");
    expect(formatCombo("Super+Shift+Digit3")).toBe("Win + Shift + 3");
  });
});
