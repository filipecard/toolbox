import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** "Iniciar com o Windows" — the same switch the installer offers (HKCU Run
 * value "ToolBox", see commands/setup.rs). */
export function StartupSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<boolean>("autostart_enabled").then(setEnabled);
  }, []);

  const toggle = async (next: boolean) => {
    setError(null);
    try {
      setEnabled(await invoke<boolean>("set_autostart", { enabled: next }));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Inicialização</h3>
      <label className="settings-row startup-toggle">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>Iniciar o ToolBox junto com o Windows</span>
      </label>
      <p className="settings-hint">A bolinha aparece no canto da tela assim que você entra no Windows.</p>
      {error && <p className="ocr-error">{error}</p>}
    </section>
  );
}
