import { useEffect, useState } from "react";
import { applyShortcuts } from "../shared/tauri";
import { DEFAULT_SHORTCUTS, isInstalled, type AppSettings } from "../shared/settingsStore";
import { TOOL_CATALOG } from "./toolCatalog";
import { MODIFIER_CODES, comboFromEvent, formatCombo } from "./shortcutFormat";

/** Everything a shortcut can open: the quick menu, the notes bar, every
 * tool window, and Settings. */
const ACTIONS: { id: string; label: string }[] = [
  { id: "quick-menu", label: "Menu rápido" },
  { id: "notes", label: "Notas" },
  ...TOOL_CATALOG.filter((t) => t.load).map((t) => ({ id: t.toolId, label: t.defaultLabel })),
  { id: "settings", label: "Configurações" },
];

export function ShortcutsSection({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (next: AppSettings) => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const apply = (shortcuts: Record<string, string>) =>
    void applyShortcuts(shortcuts).then((errs) =>
      setErrors(Object.fromEntries(errs.map((e) => [e.action, e.message]))),
    );

  const save = (shortcuts: Record<string, string>) => {
    update({ ...settings, shortcuts });
    apply(shortcuts);
  };

  const setCombo = (action: string, combo: string | null) => {
    const next = { ...settings.shortcuts };
    if (combo) next[action] = combo;
    else delete next[action];
    save(next);
  };

  // While recording, the registered shortcuts are released — a registered
  // combination is swallowed by Windows before this window ever sees the
  // key press, so it couldn't be re-recorded otherwise.
  useEffect(() => {
    if (!recording) return;
    void applyShortcuts({});
    setHint("Pressione a combinação (Esc cancela, Backspace remove)");

    // Blurs the recorder button when done: otherwise the key-up of a
    // just-recorded Space/Enter would "click" it and start recording again.
    const finish = () => {
      (document.activeElement as HTMLElement | null)?.blur();
      setRecording(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        finish();
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        setCombo(recording, null);
        finish();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) {
        if (!MODIFIER_CODES.has(e.code)) setHint("Use pelo menos Ctrl, Alt, Shift ou Win junto com a tecla");
        return;
      }
      const owner = Object.entries(settings.shortcuts).find(([a, c]) => c === combo && a !== recording);
      if (owner) {
        const label = ACTIONS.find((a) => a.id === owner[0])?.label ?? owner[0];
        setHint(`${formatCombo(combo)} já abre "${label}"`);
        return;
      }
      setCombo(recording, combo);
      finish();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      setHint(null);
    };
  }, [recording]);

  // On open, and whenever recording ends (including Esc / clicking
  // elsewhere): registers the saved bindings, which also reports the ones
  // that fail (combination taken by another program).
  useEffect(() => {
    if (recording === null) apply(settings.shortcuts);
  }, [recording]);

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Atalhos de teclado</h3>
      <p className="settings-hint">
        Abra qualquer ferramenta de qualquer lugar, sem clicar na bolinha. Pressionar o atalho de
        novo com a ferramenta em foco minimiza ela.
      </p>
      <div className="shortcut-list">
        {ACTIONS.filter((action) => {
          // Tools removed in "Ferramentas" can't have a shortcut.
          const item = settings.quickMenuItems.find((i) => i.toolId === action.id);
          return !item || isInstalled(item);
        }).map((action) => {
          const combo = settings.shortcuts[action.id];
          const isRecording = recording === action.id;
          return (
            <div className="shortcut-row" key={action.id}>
              <span className="shortcut-label">{action.label}</span>
              <button
                className={`shortcut-key${isRecording ? " shortcut-key-recording" : ""}${
                  errors[action.id] ? " shortcut-key-error" : ""
                }`}
                onClick={() => setRecording(isRecording ? null : action.id)}
                onBlur={() => isRecording && setRecording(null)}
                title={errors[action.id] ?? "Clique para gravar um atalho"}
              >
                {isRecording ? "Pressione..." : combo ? formatCombo(combo) : "—"}
              </button>
              {combo && !isRecording && (
                <span className="clip-item-remove" title="Remover atalho" onClick={() => setCombo(action.id, null)}>
                  ×
                </span>
              )}
              {errors[action.id] && <span className="shortcut-error">{errors[action.id]}</span>}
            </div>
          );
        })}
      </div>
      {hint && <p className="settings-hint">{hint}</p>}
      <div className="settings-row">
        <button className="var-add-btn" onClick={() => save(DEFAULT_SHORTCUTS)}>
          Restaurar padrão
        </button>
      </div>
    </section>
  );
}
