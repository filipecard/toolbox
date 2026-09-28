import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { installDependency, type DependencyProgress } from "./tauri";

/** One-click download of a tool's dependency package (verified and
 * extracted by the Rust side), with progress. */
export function DependencyInstaller({
  id,
  label,
  approxMb,
  onInstalled,
}: {
  id: string;
  label: string;
  approxMb: number;
  onInstalled: () => void;
}) {
  const [progress, setProgress] = useState<DependencyProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<DependencyProgress>("dependency-progress", (e) => {
      if (e.payload.id === id) setProgress(e.payload);
    });
    return () => void unlisten.then((f) => f());
  }, [id]);

  const install = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await installDependency(id);
      onInstalled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return (
    <div className="dep-installer">
      <button className="var-add-btn" disabled={busy} onClick={() => void install()}>
        {busy
          ? progress?.stage === "extracting"
            ? "Instalando…"
            : `Baixando${percent !== null ? ` ${percent}%` : "…"}`
          : `Baixar ${label} (~${approxMb} MB)`}
      </button>
      {busy && percent !== null && (
        <div className="dep-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${percent}%` }} />
        </div>
      )}
      {error && <p className="ocr-error">{error}</p>}
    </div>
  );
}
