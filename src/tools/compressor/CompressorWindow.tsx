import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool, compressorQuota, consumeCompressorUse, type CompressorQuota } from "../../shared/tauri";
import { formatBytes } from "../../shared/format";
import { processImage, swapExtension, triggerDownload, type ImageFormat } from "./imageProcessing";

type EntryStatus = "pending" | "processing" | "done" | "error" | "limited";

interface FileEntry {
  id: string;
  file: File;
  status: EntryStatus;
  resultBlob?: Blob;
  resultSize?: number;
  error?: string;
}

const FORMAT_OPTIONS: { id: ImageFormat; label: string }[] = [
  { id: "jpeg", label: "JPEG" },
  { id: "webp", label: "WebP" },
  { id: "png", label: "PNG" },
];

export function CompressorWindow({ toolId }: { toolId: string }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(0.8);
  const [maxWidth, setMaxWidth] = useState(0);
  const [quota, setQuota] = useState<CompressorQuota | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void compressorQuota().then(setQuota);
  }, []);

  const addFiles = (fileList: FileList | File[]) => {
    const images = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    setEntries((prev) => [
      ...prev,
      ...images.map((file) => ({ id: uuidv4(), file, status: "pending" as const })),
    ]);
  };

  const handleRemove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const handleClear = () => setEntries([]);

  const handleCompressAll = async () => {
    setBusy(true);
    for (const entry of entries) {
      if (entry.status !== "pending") continue;

      try {
        const nextQuota = await consumeCompressorUse();
        setQuota(nextQuota);
      } catch (e) {
        const message = String(e);
        setEntries((prev) =>
          prev.map((x) => (x.status === "pending" ? { ...x, status: "limited", error: message } : x)),
        );
        break;
      }

      setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, status: "processing" } : x)));
      try {
        const result = await processImage(entry.file, format, quality, maxWidth);
        setEntries((prev) =>
          prev.map((x) =>
            x.id === entry.id
              ? { ...x, status: "done", resultBlob: result.blob, resultSize: result.blob.size }
              : x,
          ),
        );
      } catch (e) {
        setEntries((prev) =>
          prev.map((x) => (x.id === entry.id ? { ...x, status: "error", error: String(e) } : x)),
        );
      }
    }
    setBusy(false);
  };

  const handleDownload = (entry: FileEntry) => {
    if (!entry.resultBlob) return;
    triggerDownload(entry.resultBlob, swapExtension(entry.file.name, format));
  };

  const handleDownloadAll = () => {
    entries.forEach((entry) => {
      if (entry.status === "done" && entry.resultBlob) {
        triggerDownload(entry.resultBlob, swapExtension(entry.file.name, format));
      }
    });
  };

  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const hasDone = entries.some((e) => e.status === "done");
  const quotaExceeded = quota ? quota.used >= quota.limit : false;

  return (
    <div className="panel compressor">
      <TitleBar
        title="Compressor de imagem"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body comp-body">
        <div
          className={`ocr-dropzone comp-dropzone${dragOver ? " ocr-dropzone-active" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <span className="ocr-dropzone-hint">
            Arraste imagens aqui ou clique para escolher (pode selecionar várias)
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="comp-settings">
          <div className="comp-format-row">
            <span className="dt-field-label">Formato</span>
            <div className="conv-tabs">
              {FORMAT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  className={`conv-tab${format === f.id ? " conv-tab-active" : ""}`}
                  onClick={() => setFormat(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {format !== "png" && (
            <div className="settings-row">
              <label className="settings-row-label">Qualidade</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
              <span className="settings-row-value">{Math.round(quality * 100)}%</span>
            </div>
          )}
          <div className="settings-row">
            <label className="settings-row-label">Largura máx.</label>
            <input
              type="number"
              className="cp-num-input comp-width-input"
              min={0}
              placeholder="original"
              value={maxWidth || ""}
              onChange={(e) => setMaxWidth(Number(e.target.value) || 0)}
            />
            <span className="settings-row-value">px (0 = original)</span>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="comp-list">
            {entries.map((entry) => (
              <div className="comp-row" key={entry.id}>
                <div className="comp-row-info">
                  <span className="comp-row-name">{entry.file.name}</span>
                  <span className="comp-row-size">
                    {formatBytes(entry.file.size)}
                    {entry.status === "done" && entry.resultSize != null && (
                      <>
                        {" → "}
                        {formatBytes(entry.resultSize)} (
                        {Math.max(0, Math.round((1 - entry.resultSize / entry.file.size) * 100))}% menor)
                      </>
                    )}
                  </span>
                  {entry.status === "processing" && (
                    <span className="comp-row-status">Processando...</span>
                  )}
                  {(entry.status === "error" || entry.status === "limited") && (
                    <span className="comp-row-status comp-row-error">{entry.error}</span>
                  )}
                </div>
                {entry.status === "done" && (
                  <button className="cp-copy-btn" onClick={() => handleDownload(entry)}>
                    Baixar
                  </button>
                )}
                <button className="clip-item-remove" onClick={() => handleRemove(entry.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="comp-actions">
          <button
            className="var-add-btn"
            disabled={pendingCount === 0 || busy || quotaExceeded}
            onClick={() => void handleCompressAll()}
          >
            {busy ? "Processando..." : `Comprimir${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
          </button>
          <button className="var-add-btn" disabled={!hasDone} onClick={handleDownloadAll}>
            Baixar todos
          </button>
          <button className="var-add-btn" disabled={entries.length === 0} onClick={handleClear}>
            Limpar lista
          </button>
        </div>
        {quota && (
          <span className="ocr-quota">
            Grátis: {quota.used}/{quota.limit} hoje{quotaExceeded && " — limite atingido"}
          </span>
        )}
      </div>
    </div>
  );
}
