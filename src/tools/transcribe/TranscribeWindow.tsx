import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { SearchableSelect } from "../../shell/SearchableSelect";
import {
  collapseTool,
  getWhisperModelPath,
  setWhisperModelPath,
  setupWhisper,
  transcribeAudio,
  transcribeQuota,
  whisperSetupStatus,
  type TranscribeQuota,
} from "../../shared/tauri";
import { toWavBytes } from "./audioConvert";
import { WHISPER_LANGUAGES } from "./whisperLanguages";

const LANG_OPTIONS = WHISPER_LANGUAGES.map((l) => ({ id: l.code, label: l.name }));

interface SetupProgress {
  stage: string;
  percent: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  checking: "Verificando...",
  finding_release: "Localizando a versão mais recente...",
  downloading_binary: "Baixando whisper.cpp...",
  extracting: "Instalando...",
  downloading_model: "Baixando modelo de reconhecimento de voz (~140 MB)...",
  done: "Pronto!",
};

export function TranscribeWindow({ toolId }: { toolId: string }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelPathInput, setModelPathInput] = useState("");

  const [lang, setLang] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"converting" | "transcribing" | null>(null);
  const [quota, setQuota] = useState<TranscribeQuota | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void transcribeQuota().then(setQuota);
    void whisperSetupStatus().then((s) => setReady(s.ready));
    void getWhisperModelPath().then((p) => setModelPathInput(p ?? ""));
  }, []);

  useEffect(() => {
    const unlisten = listen<SetupProgress>("whisper-setup-progress", (e) => setSetupProgress(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const handleAutoSetup = async () => {
    setSetupError(null);
    setSetupProgress({ stage: "checking", percent: null });
    try {
      const status = await setupWhisper();
      setReady(status.ready);
    } catch (e) {
      setSetupError(String(e));
    } finally {
      setSetupProgress(null);
    }
  };

  const handleSaveModelPath = async () => {
    const trimmed = modelPathInput.trim();
    await setWhisperModelPath(trimmed);
    void whisperSetupStatus().then((s) => setReady(s.ready));
  };

  const handleFile = (nextFile: File) => {
    setError(null);
    setText("");
    setFile(nextFile);
  };

  const handleTranscribe = async () => {
    if (!file) return;
    setError(null);
    try {
      setStage("converting");
      const wavBytes = await toWavBytes(file);
      setStage("transcribing");
      const result = await transcribeAudio(Array.from(wavBytes), "audio.wav", lang);
      setText(result.text);
      setQuota({ used: result.used, limit: result.limit });
    } catch (e) {
      setError(String(e));
    } finally {
      setStage(null);
    }
  };

  const quotaExceeded = quota ? quota.used >= quota.limit : false;
  const busy = stage !== null;
  const settingUp = setupProgress !== null;

  const setupStageLabel = STAGE_LABELS[setupProgress?.stage ?? ""] ?? "Configurando...";
  const setupPercent = setupProgress?.percent;
  const setupButtonLabel = settingUp
    ? setupPercent != null
      ? `${setupStageLabel} ${Math.round(setupPercent)}%`
      : setupStageLabel
    : "Baixar e configurar automaticamente";

  return (
    <div className="panel transcribe">
      <TitleBar
        title="Transcrição de áudio"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body trans-audio-body">
        {ready === false && (
          <div className="trans-audio-setup">
            <p className="settings-hint">
              Essa ferramenta precisa de um reconhecedor de voz local (whisper.cpp, de código
              aberto) e de um modelo de IA (~140 MB) — nenhum dos dois vem junto com o instalador.
              Baixe uma vez e fica pronto pra sempre.
            </p>
            <button className="var-add-btn" disabled={settingUp} onClick={() => void handleAutoSetup()}>
              {setupButtonLabel}
            </button>
            {setupError && <p className="ocr-error">{setupError}</p>}

            <button className="dt-guide-toggle" onClick={() => setShowAdvanced((v) => !v)}>
              Avançado: já tenho whisper.cpp instalado {showAdvanced ? "▴" : "▾"}
            </button>
            {showAdvanced && (
              <div className="conv-row">
                <input
                  className="conv-value-input"
                  value={modelPathInput}
                  onChange={(e) => setModelPathInput(e.target.value)}
                  placeholder="Caminho completo do modelo .bin"
                  spellCheck={false}
                />
                <button className="cp-copy-btn" onClick={() => void handleSaveModelPath()}>
                  Salvar
                </button>
              </div>
            )}
          </div>
        )}

        {ready && (
          <>
            <div className="trans-audio-lang">
              <span className="dt-field-label">Idioma</span>
              <SearchableSelect options={LANG_OPTIONS} value={lang} onChange={setLang} />
            </div>

            <div
              className={`ocr-dropzone${dragOver ? " ocr-dropzone-active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) handleFile(dropped);
              }}
            >
              <span className="ocr-dropzone-hint">
                {file?.name ?? "Arraste um áudio aqui ou clique para escolher"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) handleFile(picked);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="settings-hint">
              Aceita qualquer formato que o navegador consiga tocar (wav, mp3, ogg/opus —
              inclusive áudios do WhatsApp —, m4a, webm...); é convertido automaticamente.
            </p>

            <div className="ocr-actions">
              <button
                className="var-add-btn"
                disabled={!file || busy || quotaExceeded}
                onClick={() => void handleTranscribe()}
              >
                {stage === "converting"
                  ? "Convertendo áudio..."
                  : stage === "transcribing"
                    ? "Transcrevendo..."
                    : "Transcrever"}
              </button>
              {quota && (
                <span className="ocr-quota">
                  Grátis: {quota.used}/{quota.limit} hoje
                </span>
              )}
            </div>

            {error && <p className="ocr-error">{error}</p>}

            <textarea
              className="ocr-result"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="A transcrição aparecerá aqui."
            />
            {text && (
              <button className="var-add-btn" onClick={() => void navigator.clipboard.writeText(text)}>
                Copiar texto
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
