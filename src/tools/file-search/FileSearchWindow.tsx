import { useEffect, useRef, useState } from "react";
import { planLabel, usePlanStatus } from "../../shared/plans";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import {
  ALL_DRIVES_ROOT,
  collapseTool,
  defaultSearchRoot,
  ensureFileIndex,
  fileIndexStatus,
  searchFiles,
  type FileIndexStatus,
  type FileSearchResult,
} from "../../shared/tauri";
import { formatBytes } from "../../shared/format";

// Queries hit an in-memory index now, so this only needs to skip keystrokes
// typed in quick succession, not protect the disk.
const SEARCH_DEBOUNCE_MS = 120;
const STATUS_POLL_MS = 500;
const ROOT_STORAGE_KEY = "fileSearch.root";

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCount(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatAge(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h`;
}

function loadSavedRoot(): string | null {
  try {
    return localStorage.getItem(ROOT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveRoot(root: string) {
  try {
    localStorage.setItem(ROOT_STORAGE_KEY, root);
  } catch {
    // not critical — the tool just falls back to the home folder next time
  }
}

export function FileSearchWindow({ toolId }: { toolId: string }) {
  const [root, setRoot] = useState("");
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState("");
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [shownLimit, setShownLimit] = useState(0);
  const plan = usePlanStatus();
  const [status, setStatus] = useState<FileIndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const saved = loadSavedRoot();
    if (saved) setRoot(saved);
    else void defaultSearchRoot().then(setRoot);
  }, []);

  // (Re)build the index whenever the root changes (a no-op on the Rust side
  // when a fresh index for it already exists).
  useEffect(() => {
    if (!root) return;
    setError(null);
    ensureFileIndex(root)
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, [root]);

  const indexing = !!status?.indexing_root;
  const ready = status?.ready_root === root;

  // Poll progress while a build is running.
  useEffect(() => {
    if (!indexing) return;
    const intervalId = setInterval(() => {
      void fileIndexStatus().then(setStatus);
    }, STATUS_POLL_MS);
    return () => clearInterval(intervalId);
  }, [indexing]);

  useEffect(() => {
    if ((!query.trim() && !extension.trim()) || !ready) {
      setResults([]);
      setTotal(0);
      setTruncated(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timeoutId = setTimeout(() => {
      searchFiles(root, query, extension)
        .then((res) => {
          if (requestIdRef.current !== requestId) return; // a newer search already superseded this one
          setResults(res.results);
          setTotal(res.total);
          setTruncated(res.truncated);
          setShownLimit(res.limit);
          setError(null);
        })
        .catch((e) => {
          if (requestIdRef.current !== requestId) return;
          setError(String(e));
          setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
    // built_at: re-run the current query once a refreshed index lands
  }, [root, query, extension, ready, status?.built_at]);

  const changeRoot = (next: string) => {
    setRoot(next);
    saveRoot(next);
  };

  const pickFolder = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Escolha a pasta onde buscar",
      defaultPath: root && root !== ALL_DRIVES_ROOT ? root : undefined,
    });
    if (typeof picked === "string") changeRoot(picked);
  };

  const refreshIndex = () => {
    ensureFileIndex(root, true)
      .then(setStatus)
      .catch((e) => setError(String(e)));
  };

  const allDrives = root === ALL_DRIVES_ROOT;
  const hasQuery = !!(query.trim() || extension.trim());

  return (
    <div className="panel file-search">
      <TitleBar
        title="Busca de arquivos"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body fs-body">
        <div className="fs-field">
          <span className="dt-field-label">Onde buscar</span>
          <div className="fs-root-row">
            <button className="fs-root-display" onClick={() => void pickFolder()} title={allDrives ? "" : root}>
              <span className="fs-root-icon">{allDrives ? "💻" : "📁"}</span>
              <span className="fs-root-text">{allDrives ? "Todo o computador" : root || "..."}</span>
            </button>
            <button className="var-add-btn" onClick={() => void pickFolder()}>
              Escolher pasta
            </button>
            {!allDrives && (
              <button className="var-add-btn" onClick={() => changeRoot(ALL_DRIVES_ROOT)} title="Buscar em todos os discos">
                Todo o PC
              </button>
            )}
          </div>
        </div>

        <div className="fs-row">
          <input
            className="conv-value-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome..."
            spellCheck={false}
            autoFocus
          />
          <input
            className="cp-field-input fs-ext-input"
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            placeholder="ext (ex: pdf)"
            spellCheck={false}
          />
        </div>

        <div className="fs-status">
          {indexing ? (
            <span>
              <span className="fs-spinner" /> Indexando... {formatCount(status?.progress ?? 0)} itens
              {ready && " (usando o índice anterior enquanto isso)"}
            </span>
          ) : ready && status ? (
            <span>
              {formatCount(status.count)} itens indexados · {formatAge(status.built_at)}
            </span>
          ) : (
            <span />
          )}
          {ready && !indexing && (
            <button className="fs-refresh-btn" onClick={refreshIndex} title="Reindexar para incluir arquivos novos">
              ↻ Atualizar
            </button>
          )}
        </div>

        {error && <p className="ocr-error">{error}</p>}
        {ready && hasQuery && total > 0 && (
          <p className="settings-hint">
            {formatCount(total)} resultado{total === 1 ? "" : "s"}
            {truncated &&
              ` — mostrando os primeiros ${formatCount(shownLimit)} (limite do plano ${
                plan ? planLabel(plan, "file-search") : ""
              }; faça upgrade para ver mais)`}
          </p>
        )}

        <div className="fs-list">
          {!ready && indexing && hasQuery && (
            <p className="settings-hint rem-empty">A busca começa assim que a indexação terminar.</p>
          )}
          {ready && hasQuery && results.length === 0 && !error && (
            <p className="settings-hint rem-empty">Nenhum resultado.</p>
          )}
          {results.map((r) => (
            <div className="comp-row" key={r.path}>
              <div className="comp-row-info">
                <span className="comp-row-name">
                  {r.is_dir ? "📁" : "📄"} {r.name}
                </span>
                <span className="comp-row-size fs-path" title={r.path}>
                  {r.path}
                </span>
                {!r.is_dir && (
                  <span className="comp-row-size">
                    {formatBytes(r.size)} · {formatDate(r.modified)}
                  </span>
                )}
              </div>
              <button className="cp-copy-btn" onClick={() => void openPath(r.path)}>
                Abrir
              </button>
              <button className="cp-copy-btn" onClick={() => void revealItemInDir(r.path)}>
                Localizar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
