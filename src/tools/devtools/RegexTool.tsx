import { useMemo, useRef, useState } from "react";
import { SearchableSelect } from "../../shell/SearchableSelect";
import { REGEX_FLAGS_GUIDE, REGEX_PRESETS, REGEX_SYNTAX_GUIDE } from "./regexPresets";

interface MatchResult {
  text: string;
  index: number;
  groups: (string | undefined)[];
}

const PRESET_OPTIONS = REGEX_PRESETS.map((p) => ({
  id: p.id,
  label: `${p.kind === "validate" ? "✅" : "🔍"} ${p.label}`,
  sublabel: p.description,
}));

/** Someone copying a regex from docs/code naturally copies the whole
 * `/pattern/flags` JS literal, delimiters included, and pastes that into
 * the pattern field. Taken literally, those `/`s (and the escaped `\/`s
 * inside) become part of the pattern itself instead of delimiters — which
 * compiles fine but matches nothing, silently. Detected and unwrapped here
 * so pasting either form just works, without rewriting what's shown in the
 * pattern/flags fields. */
function resolvePatternAndFlags(raw: string, fieldFlags: string): { pattern: string; flags: string } {
  const delimited = raw.match(/^\/(.*)\/([a-z]*)$/s);
  if (delimited) return { pattern: delimited[1], flags: delimited[2] || fieldFlags };
  return { pattern: raw, flags: fieldFlags };
}

/** Renders the test string as plain text with each match wrapped in
 * <mark>, so it reads like a highlighter run over the text instead of a
 * separate list of index ranges. Matches from matchAll/exec are already in
 * order and non-overlapping, so a single left-to-right sweep is enough. */
function renderHighlighted(text: string, matches: MatchResult[]) {
  if (matches.length === 0) return text;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.index > cursor) nodes.push(text.slice(cursor, m.index));
    nodes.push(
      <mark className="dt-regex-mark" key={i}>
        {m.text}
      </mark>,
    );
    cursor = m.index + m.text.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  // A trailing newline needs a trailing space to render its own empty line
  // in the highlight layer — otherwise it collapses and the layer's height
  // stops matching the textarea's, throwing off the overlay alignment.
  if (text.endsWith("\n")) nodes.push(" ");
  return nodes;
}

export function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [testString, setTestString] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const highlightRef = useRef<HTMLDivElement>(null);

  const applyPreset = (id: string) => {
    const preset = REGEX_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSelectedPreset(id);
    setPattern(preset.pattern);
    setFlags(preset.flags);
  };

  const { matches, error, multilineHint } = useMemo(() => {
    if (!pattern) {
      return { matches: [] as MatchResult[], error: null as string | null, multilineHint: false };
    }
    const { pattern: effectivePattern, flags: effectiveFlags } = resolvePatternAndFlags(pattern, flags);
    // ^ and $ anchor to the start/end of the WHOLE string by default, not
    // each line — a very common surprise for anyone assuming the "g" flag
    // (find every occurrence) also makes them line-aware, which is actually
    // what "m" does. Flagged here so the UI can explain it right when it's
    // relevant, instead of just silently returning 0 matches.
    const multilineHint =
      /[$^]/.test(effectivePattern) && !effectiveFlags.includes("m") && testString.includes("\n");
    try {
      const re = new RegExp(effectivePattern, effectiveFlags);
      const results: MatchResult[] = [];
      if (effectiveFlags.includes("g")) {
        for (const m of testString.matchAll(re)) {
          results.push({ text: m[0], index: m.index ?? 0, groups: m.slice(1) });
        }
      } else {
        const m = re.exec(testString);
        if (m) results.push({ text: m[0], index: m.index, groups: m.slice(1) });
      }
      return { matches: results, error: null as string | null, multilineHint };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { matches: [] as MatchResult[], error: message, multilineHint };
    }
  }, [pattern, flags, testString]);

  return (
    <div className="dt-pane">
      <div className="dt-preset-row">
        <SearchableSelect
          options={PRESET_OPTIONS}
          value={selectedPreset}
          placeholder="Padrões prontos (mais usados)"
          onChange={applyPreset}
        />
        <p className="settings-hint">
          ✅ valida a string inteira (0 ou 1 resultado) · 🔍 busca em qualquer parte do texto (vários
          resultados)
        </p>
      </div>

      <div className="dt-regex-row">
        <span className="dt-field-label">/</span>
        <input
          className="cp-field-input"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="padrão"
          spellCheck={false}
        />
        <span className="dt-field-label">/</span>
        <input
          className="dt-flags-input"
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="gi"
          spellCheck={false}
        />
      </div>
      <p className="settings-hint">
        Pode colar com ou sem as barras (ex: <code>\d+</code> ou <code>/\d+/g</code>) — detectamos
        automaticamente.
      </p>
      <div className="dt-regex-editor">
        <div
          ref={highlightRef}
          className="dt-regex-highlight"
          aria-hidden="true"
        >
          {renderHighlighted(testString, matches)}
        </div>
        <textarea
          className="dt-regex-textarea"
          value={testString}
          onChange={(e) => setTestString(e.target.value)}
          onScroll={(e) => {
            if (highlightRef.current) {
              highlightRef.current.scrollTop = e.currentTarget.scrollTop;
              highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          placeholder="Texto de teste..."
          spellCheck={false}
        />
      </div>
      {error && <p className="ocr-error">{error}</p>}
      {multilineHint && (
        <p className="settings-hint">
          💡 Seu padrão usa <code>^</code>/<code>$</code> e o texto tem várias linhas — por padrão eles
          valem pra string inteira, não por linha. Adicione a flag <code>m</code> pra aplicar por linha,
          ou tire o <code>^</code>/<code>$</code> se quiser só encontrar o trecho em qualquer lugar do
          texto.
        </p>
      )}
      <p className="settings-hint">{matches.length} ocorrência(s) destacada(s) acima</p>

      <button className="dt-guide-toggle" onClick={() => setShowGuide((v) => !v)}>
        📘 Guia rápido de regex {showGuide ? "▴" : "▾"}
      </button>
      {showGuide && (
        <div className="dt-guide">
          <span className="cp-section-label">Sintaxe</span>
          {REGEX_SYNTAX_GUIDE.map((g) => (
            <div className="dt-guide-row" key={g.symbol}>
              <span className="dt-guide-symbol">{g.symbol}</span>
              <span className="dt-guide-meaning">{g.meaning}</span>
            </div>
          ))}
          <span className="cp-section-label dt-guide-flags-label">Flags</span>
          {REGEX_FLAGS_GUIDE.map((g) => (
            <div className="dt-guide-row" key={g.symbol}>
              <span className="dt-guide-symbol">{g.symbol}</span>
              <span className="dt-guide-meaning">{g.meaning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
