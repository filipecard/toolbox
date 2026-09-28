import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import {
  addClipboardSnippet,
  clearClipboardHistory,
  clipboardImage,
  collapseTool,
  copyClipboardEntry,
  listClipboardHistory,
  removeClipboardEntry,
  setClipboardPinned,
  updateClipboardSnippet,
  type ClipboardEntry,
} from "../../shared/tauri";
import { formatLimit, planLabel, usePlanStatus } from "../../shared/plans";

const TABS = [
  { id: "history", label: "Histórico" },
  { id: "pinned", label: "Fixados" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Thumbnail of an image entry, loaded once from Rust as a blob URL. */
function ClipImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void clipboardImage(id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url ? <img className="clip-item-image" src={url} alt="" /> : <div className="clip-item-image-placeholder" />;
}

interface SnippetDraft {
  /** Set when editing an existing snippet. */
  id?: string;
  title: string;
  text: string;
}

export function ClipboardWindow({ toolId }: { toolId: string }) {
  const [history, setHistory] = useState<ClipboardEntry[]>([]);
  const [tab, setTab] = useState<TabId>("history");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SnippetDraft | null>(null);
  // Display only — the caps themselves are applied in Rust (commands/clipboard.rs).
  const plan = usePlanStatus();

  useEffect(() => {
    void listClipboardHistory().then(setHistory);
    const unlisten = listen<ClipboardEntry[]>("clipboard-history-changed", (e) => setHistory(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter(
      (e) =>
        (tab === "history" || e.pinned) &&
        (!q || e.text.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q)),
    );
  }, [history, query, tab]);

  const run = (action: Promise<unknown>) => {
    setError(null);
    void action.catch((e) => setError(String(e)));
  };

  const handleCopyBack = (entry: ClipboardEntry) => {
    run(
      copyClipboardEntry(entry.id).then(() => {
        setCopiedId(entry.id);
        setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1000);
      }),
    );
  };

  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  const saveDraft = () => {
    if (!draft) return;
    run(
      (draft.id
        ? updateClipboardSnippet(draft.id, draft.title, draft.text)
        : addClipboardSnippet(draft.title, draft.text)
      ).then(() => setDraft(null)),
    );
  };

  const unpinnedCount = history.filter((e) => !e.pinned).length;
  const pinnedCount = history.length - unpinnedCount;
  const planName = plan ? planLabel(plan, "clipboard") : "";

  return (
    <div className="panel clipboard">
      <TitleBar
        title="Clipboard"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body clip-body">
        <div className="conv-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`conv-tab${tab === t.id ? " conv-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          className="clip-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "history" ? "Buscar no histórico..." : "Buscar nos fixados..."}
          spellCheck={false}
        />

        {tab === "pinned" &&
          (draft ? (
            <div className="clip-snippet-form">
              <input
                className="clip-search"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Título (opcional) — ex.: Assinatura de e-mail"
              />
              <textarea
                className="dt-textarea dt-textarea-short"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                placeholder="Texto que será copiado ao clicar"
                autoFocus
              />
              <div className="rem-timer-actions">
                <button className="var-add-btn" onClick={saveDraft} disabled={!draft.text.trim()}>
                  Salvar
                </button>
                <button className="var-add-btn" onClick={() => setDraft(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button className="var-add-btn" onClick={() => setDraft({ title: "", text: "" })}>
              + Novo texto pronto
            </button>
          ))}

        {error && <p className="ocr-error">{error}</p>}

        <div className="clip-list">
          {filtered.length === 0 && (
            <p className="settings-hint clip-empty">
              {query
                ? "Nenhum resultado para essa busca."
                : tab === "history"
                  ? "Nada copiado ainda. Copie um texto ou imagem (Ctrl+C) para vê-lo aqui."
                  : "Nada fixado. Use ☆ num item do histórico, ou crie um texto pronto."}
            </p>
          )}
          {filtered.map((entry) => (
            <button
              key={entry.id}
              className={`clip-item${entry.pinned ? " clip-item-pinned" : ""}`}
              onClick={() => handleCopyBack(entry)}
              title="Clique para copiar novamente"
            >
              {entry.title && <span className="clip-item-title">{entry.title}</span>}
              {entry.kind === "image" ? (
                <ClipImage id={entry.id} />
              ) : (
                <span className="clip-item-text">{entry.text}</span>
              )}
              <span className="clip-item-meta">
                <span className="clip-item-time">
                  {copiedId === entry.id
                    ? "Copiado!"
                    : entry.kind === "image" && entry.image
                      ? `${entry.image.width}×${entry.image.height} · ${formatTime(entry.created_at)}`
                      : formatTime(entry.created_at)}
                </span>
                <span className="clip-item-actions">
                  {entry.pinned && entry.kind === "text" && (
                    <span
                      className="clip-item-action"
                      title="Editar"
                      onClick={(e) =>
                        stop(e, () => setDraft({ id: entry.id, title: entry.title ?? "", text: entry.text }))
                      }
                    >
                      ✎
                    </span>
                  )}
                  <span
                    className={`clip-item-action${entry.pinned ? " clip-item-action-on" : ""}`}
                    title={entry.pinned ? "Desafixar" : "Fixar (não sai do histórico)"}
                    onClick={(e) => stop(e, () => run(setClipboardPinned(entry.id, !entry.pinned)))}
                  >
                    {entry.pinned ? "★" : "☆"}
                  </span>
                  <span
                    className="clip-item-remove"
                    title="Remover"
                    onClick={(e) => stop(e, () => run(removeClipboardEntry(entry.id)))}
                  >
                    ×
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="clip-footer">
          <span className="settings-hint">
            {plan &&
              (tab === "history"
                ? plan.limits.clipboardHistory === null
                  ? `${unpinnedCount} itens · plano ${planName}: histórico ilimitado`
                  : `${unpinnedCount}/${formatLimit(plan.limits.clipboardHistory)} itens · plano ${planName}`
                : plan.limits.clipboardPinned === null
                  ? `${pinnedCount} fixados · plano ${planName}: ilimitado`
                  : `${pinnedCount}/${formatLimit(plan.limits.clipboardPinned)} fixados · plano ${planName}`)}
          </span>
          {tab === "history" && (
            <button
              className="var-add-btn"
              onClick={() => run(clearClipboardHistory())}
              disabled={unpinnedCount === 0}
              title="Os itens fixados são mantidos"
            >
              Limpar histórico
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
