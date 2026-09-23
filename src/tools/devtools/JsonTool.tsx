import { useEffect, useRef, useState } from "react";

// Plain (not JSON-aware) bracket/quote auto-pairing — matches how most code
// editors' basic auto-close works, not a full tokenizer. Good enough for
// "typing conveniences" without the complexity of actually parsing partial
// JSON on every keystroke.
const OPEN_TO_CLOSE: Record<string, string> = { "{": "}", "[": "]", '"': '"' };

export function JsonTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  // Restores the cursor position after an auto-pairing edit — a controlled
  // <textarea>'s selection isn't preserved automatically across a value
  // change driven by React state rather than the user's own keystroke.
  useEffect(() => {
    if (pendingSelection.current && textareaRef.current) {
      const [start, end] = pendingSelection.current;
      textareaRef.current.setSelectionRange(start, end);
      pendingSelection.current = null;
    }
  }, [input]);

  // Live validation as you type — separate from the explicit
  // Formatar/Minificar actions below, which only touch `output` when
  // clicked so in-progress edits don't clobber a result you're comparing
  // against.
  useEffect(() => {
    if (!input.trim()) {
      setLiveError(null);
      return;
    }
    const id = setTimeout(() => {
      try {
        JSON.parse(input);
        setLiveError(null);
      } catch (e) {
        setLiveError(String(e));
      }
    }, 150);
    return () => clearTimeout(id);
  }, [input]);

  const setValueWithSelection = (value: string, start: number, end: number) => {
    pendingSelection.current = [start, end];
    setInput(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;

    // Auto-close a typed opening char, or wrap the current selection with
    // the pair if there is one (e.g. selecting text and typing `"` quotes it).
    if (Object.prototype.hasOwnProperty.call(OPEN_TO_CLOSE, e.key)) {
      e.preventDefault();
      const close = OPEN_TO_CLOSE[e.key];
      if (start !== end) {
        const selected = value.slice(start, end);
        const next = value.slice(0, start) + e.key + selected + close + value.slice(end);
        setValueWithSelection(next, start + 1, end + 1);
        return;
      }
      // Typing a closing quote right before an already-auto-inserted one
      // just steps past it instead of inserting a redundant second quote.
      if (e.key === '"' && value[start] === '"') {
        setValueWithSelection(value, start + 1, start + 1);
        return;
      }
      const next = value.slice(0, start) + e.key + close + value.slice(end);
      setValueWithSelection(next, start + 1, start + 1);
      return;
    }

    // Typing a closing bracket that's already right there (auto-inserted)
    // steps over it instead of adding a second one.
    if ((e.key === "}" || e.key === "]") && value[start] === e.key) {
      e.preventDefault();
      setValueWithSelection(value, start + 1, start + 1);
      return;
    }

    // Backspace right inside an empty auto-inserted pair removes both at
    // once, instead of leaving a dangling unmatched closer.
    if (e.key === "Backspace" && start === end && start > 0) {
      const prevChar = value[start - 1];
      const nextChar = value[start];
      if (OPEN_TO_CLOSE[prevChar] === nextChar) {
        e.preventDefault();
        const next = value.slice(0, start - 1) + value.slice(start + 1);
        setValueWithSelection(next, start - 1, start - 1);
        return;
      }
    }

    // Tab inserts two spaces instead of jumping focus out — expected in a
    // code-ish textarea. Shift+Tab is left alone as the accessibility
    // escape hatch to tab out.
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const next = value.slice(0, start) + "  " + value.slice(end);
      setValueWithSelection(next, start + 2, start + 2);
      return;
    }

    // Enter keeps the new line's indentation matching the current one, and
    // expands an empty {}/[] pair onto three lines with the cursor indented
    // one level in between — same as most code editors.
    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      const indent = currentLine.match(/^\s*/)?.[0] ?? "";

      const charBefore = value[start - 1];
      const charAfter = value[start];
      if ((charBefore === "{" && charAfter === "}") || (charBefore === "[" && charAfter === "]")) {
        const innerIndent = indent + "  ";
        const next = value.slice(0, start) + "\n" + innerIndent + "\n" + indent + value.slice(end);
        setValueWithSelection(next, start + 1 + innerIndent.length, start + 1 + innerIndent.length);
        return;
      }

      const next = value.slice(0, start) + "\n" + indent + value.slice(end);
      setValueWithSelection(next, start + 1 + indent.length, start + 1 + indent.length);
    }
  };

  const run = (indent: number | undefined) => {
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed, null, indent));
      setFormatError(null);
    } catch (e) {
      setFormatError(String(e));
      setOutput("");
    }
  };

  return (
    <div className="dt-pane">
      <textarea
        ref={textareaRef}
        className="dt-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Cole ou digite o JSON aqui..."
        spellCheck={false}
      />
      {input.trim() &&
        (liveError ? (
          <p className="ocr-error">{liveError}</p>
        ) : (
          <p className="dt-json-ok">✓ JSON válido</p>
        ))}
      <div className="dt-actions">
        <button className="var-add-btn" onClick={() => run(2)}>
          Formatar
        </button>
        <button className="var-add-btn" onClick={() => run(undefined)}>
          Minificar
        </button>
      </div>
      {formatError && <p className="ocr-error">{formatError}</p>}
      <textarea className="dt-textarea" value={output} readOnly placeholder="Resultado" />
      {output && (
        <button className="var-add-btn" onClick={() => void navigator.clipboard.writeText(output)}>
          Copiar
        </button>
      )}
    </div>
  );
}
