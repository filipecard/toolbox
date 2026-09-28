import { useCallback, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool, extractTextFromImage } from "../../shared/tauri";
import { formatQuota, isQuotaExceeded, useQuota } from "../../shared/plans";
import { readFileAsBytes } from "../../shared/fileBytes";
import { DependencyInstaller } from "../../shared/DependencyInstaller";

export function OcrWindow({ toolId }: { toolId: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [text, setText] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useQuota("ocrDaily");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setWarning(null);
    setText("");
    setFileName(file.name);
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setFileBytes(await readFileAsBytes(file));
  }, []);

  const handleExtract = async () => {
    if (!fileBytes || !fileName) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await extractTextFromImage(fileBytes, fileName);
      setText(result.text);
      setWarning(result.warning ?? null);
      setQuota(result.quota);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const quotaExceeded = isQuotaExceeded(quota);

  return (
    <div className="panel ocr">
      <TitleBar
        title="Leitor de imagem"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body ocr-body">
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
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
        >
          {imageUrl ? (
            <img className="ocr-preview" src={imageUrl} alt="" />
          ) : (
            <span className="ocr-dropzone-hint">
              Arraste uma imagem aqui ou clique para escolher
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <div className="ocr-actions">
          <button
            className="var-add-btn"
            disabled={!fileBytes || busy || quotaExceeded}
            onClick={() => void handleExtract()}
          >
            {busy ? "Extraindo..." : "Extrair texto"}
          </button>
          {quota && (
            <span className="ocr-quota">{formatQuota(quota)}</span>
          )}
        </div>

        {error && <p className="ocr-error">{error}</p>}
        {error?.includes("Baixar Tesseract") && (
          <DependencyInstaller
            id="tesseract"
            label="Tesseract"
            approxMb={60}
            onInstalled={() => {
              setError(null);
              if (fileBytes) void handleExtract();
            }}
          />
        )}
        {warning && <p className="settings-hint">{warning}</p>}

        <textarea
          className="ocr-result"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="O texto extraído aparecerá aqui."
        />
        {text && (
          <button
            className="var-add-btn"
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            Copiar texto
          </button>
        )}
      </div>
    </div>
  );
}
