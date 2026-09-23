import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import {
  clearClipboardHistory,
  collapseTool,
  listClipboardHistory,
  removeClipboardEntry,
  type ClipboardEntry,
} from "../../shared/tauri";

// Mirrors the Rust side's FREE_HISTORY_LIMIT (commands/clipboard.rs) — just
// a display label here, the actual cap is enforced (as a client-side
// placeholder, pending the real licensing backend) where entries are
// appended.
const FREE_HISTORY_LIMIT = 10;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClipboardWindow({ toolId }: { toolId: string }) {
  const [history, setHistory] = useState<ClipboardEntry[]>([]);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    void listClipboardHistory().then(setHistory);
    const unlisten = listen<ClipboardEntry[]>("clipboard-history-changed", (e) => setHistory(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((e) => e.text.toLowerCase().includes(q));
  }, [history, query]);

  const handleCopyBack = (entry: ClipboardEntry) => {
    void navigator.clipboard.writeText(entry.text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1000);
  };

  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void removeClipboardEntry(id);
  };

  return (
    <div className="panel clipboard">
      <TitleBar
        title="Clipboard"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body clip-body">
        <input
          className="clip-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar no histórico..."
          spellCheck={false}
        />

        <div className="clip-list">
          {filtered.length === 0 && (
            <p className="settings-hint clip-empty">
              {history.length === 0
                ? "Nada copiado ainda. Copie qualquer texto (Ctrl+C) para vê-lo aqui."
                : "Nenhum resultado para essa busca."}
            </p>
          )}
          {filtered.map((entry) => (
            <button
              key={entry.id}
              className="clip-item"
              onClick={() => handleCopyBack(entry)}
              title="Clique para copiar novamente"
            >
              <span className="clip-item-text">{entry.text}</span>
              <span className="clip-item-meta">
                <span className="clip-item-time">
                  {copiedId === entry.id ? "Copiado!" : formatTime(entry.created_at)}
                </span>
                <span className="clip-item-remove" onClick={(e) => handleRemove(entry.id, e)}>
                  ×
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="clip-footer">
          <span className="settings-hint">
            {history.length}/{FREE_HISTORY_LIMIT} itens · plano pago mantém histórico ilimitado
          </span>
          <button
            className="var-add-btn"
            onClick={() => void clearClipboardHistory()}
            disabled={history.length === 0}
          >
            Limpar tudo
          </button>
        </div>
      </div>
    </div>
  );
}
