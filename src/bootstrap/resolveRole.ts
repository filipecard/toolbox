export type WindowRole =
  | { kind: "bubble"; toolId: string }
  | { kind: "quick-menu" }
  | { kind: "tool"; toolId: string }
  | { kind: "notes-bar" }
  | { kind: "note"; noteId: string }
  | { kind: "unknown"; label: string };

export function resolveRole(label: string): WindowRole {
  if (label === "quick-menu") {
    return { kind: "quick-menu" };
  }
  if (label.startsWith("bubble-")) {
    return { kind: "bubble", toolId: label.slice("bubble-".length) };
  }
  if (label.startsWith("tool-")) {
    return { kind: "tool", toolId: label.slice("tool-".length) };
  }
  if (label === "notes-bar") {
    return { kind: "notes-bar" };
  }
  if (label.startsWith("note-")) {
    return { kind: "note", noteId: label.slice("note-".length) };
  }
  return { kind: "unknown", label };
}
