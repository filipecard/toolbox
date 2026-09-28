import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exportBackup, importBackup } from "../shared/tauri";

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Export/import everything the user built up (settings and themes,
 * notes, clipboard, reminders, calculator) as one .zip — to move to
 * another PC or keep a copy. Plans are not part of it (see backup.rs). */
export function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (e) {
      setMessage({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () =>
    run(async () => {
      const path = await save({
        defaultPath: `toolbox-backup-${todayStamp()}.zip`,
        filters: [{ name: "Backup do ToolBox", extensions: ["zip"] }],
      });
      if (!path) return null;
      await exportBackup(path);
      return "Backup salvo.";
    });

  const handleImport = () =>
    run(async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Backup do ToolBox", extensions: ["zip"] }],
      });
      if (!path) return null;
      const s = await importBackup(path);
      const parts = [
        s.settings && "configurações e temas",
        s.notes > 0 && `${s.notes} nota(s)`,
        s.clipboard > 0 && `${s.clipboard} item(ns) do clipboard`,
        s.reminders > 0 && `${s.reminders} lembrete(s)`,
      ].filter(Boolean);
      return parts.length ? `Importado: ${parts.join(", ")}.` : "Nada novo para importar.";
    });

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Backup</h3>
      <p className="settings-hint">
        Salva configurações, temas, atalhos, notas, clipboard, lembretes e a calculadora num
        arquivo .zip — para guardar uma cópia ou levar para outro computador. Importar junta com o
        que já existe (nada é apagado).
      </p>
      <div className="settings-row">
        <button className="var-add-btn" disabled={busy} onClick={() => void handleExport()}>
          Exportar backup
        </button>
        <button className="var-add-btn" disabled={busy} onClick={() => void handleImport()}>
          Importar backup
        </button>
      </div>
      {message && <p className={message.error ? "ocr-error" : "settings-hint"}>{message.text}</p>}
    </section>
  );
}
