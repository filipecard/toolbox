import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool } from "../../shared/tauri";
import { SearchableSelect } from "../../shell/SearchableSelect";
import { LANGUAGES } from "./languages";
import { translateText } from "./translate";

const SOURCE_OPTIONS = [
  { id: "autodetect", label: "Detectar automaticamente" },
  ...LANGUAGES.map((l) => ({ id: l.code, label: l.name })),
];
const TARGET_OPTIONS = LANGUAGES.map((l) => ({ id: l.code, label: l.name }));

export function TranslatorWindow({ toolId }: { toolId: string }) {
  const [source, setSource] = useState("autodetect");
  const [target, setTarget] = useState("pt-BR");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await translateText(input, source, target);
      setOutput(result.translatedText);
      setDetectedLang(result.detectedLanguage ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSwap = () => {
    if (source === "autodetect") return;
    const prevSource = source;
    const prevTarget = target;
    setSource(prevTarget);
    setTarget(prevSource);
    setInput(output);
    setOutput(input);
    setDetectedLang(null);
  };

  return (
    <div className="panel translator">
      <TitleBar
        title="Tradutor"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body trans-body">
        <div className="trans-lang-row">
          <div className="trans-lang-select">
            <SearchableSelect options={SOURCE_OPTIONS} value={source} onChange={setSource} />
          </div>
          <button
            className="conv-swap-btn"
            onClick={handleSwap}
            title="Inverter idiomas"
            disabled={source === "autodetect"}
          >
            ⇄
          </button>
          <div className="trans-lang-select">
            <SearchableSelect options={TARGET_OPTIONS} value={target} onChange={setTarget} />
          </div>
        </div>

        <textarea
          className="dt-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite ou cole o texto..."
          spellCheck={false}
        />

        <button
          className="var-add-btn"
          disabled={!input.trim() || busy}
          onClick={() => void handleTranslate()}
        >
          {busy ? "Traduzindo..." : "Traduzir"}
        </button>

        {detectedLang && (
          <p className="settings-hint">
            Idioma detectado: {LANGUAGES.find((l) => l.code === detectedLang)?.name ?? detectedLang}
          </p>
        )}
        {error && <p className="ocr-error">{error}</p>}

        <textarea
          className="dt-textarea"
          value={output}
          readOnly
          placeholder="A tradução aparece aqui"
        />
        {output && (
          <button className="var-add-btn" onClick={() => void navigator.clipboard.writeText(output)}>
            Copiar
          </button>
        )}
      </div>
    </div>
  );
}
