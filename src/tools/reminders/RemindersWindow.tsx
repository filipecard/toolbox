import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import {
  addReminder,
  collapseTool,
  listReminders,
  removeReminder,
  type ReminderItem,
} from "../../shared/tauri";

const TABS = [
  { id: "timer", label: "Timer" },
  { id: "reminders", label: "Lembretes" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PRESETS = [
  { label: "Foco 25 min", minutes: 25 },
  { label: "Pausa curta 5 min", minutes: 5 },
  { label: "Pausa longa 15 min", minutes: 15 },
];

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `<input type="datetime-local">`'s value format, defaulted to ~10 minutes
 * from now so the picker doesn't start on an already-past moment. */
function defaultDateTimeInput(): string {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RemindersWindow({ toolId }: { toolId: string }) {
  const [tab, setTab] = useState<TabId>("timer");

  // --- Timer state ---
  const [totalMs, setTotalMs] = useState(PRESETS[0].minutes * 60 * 1000);
  const [remainingMs, setRemainingMs] = useState(totalMs);
  const [running, setRunning] = useState(false);
  const [timerId, setTimerId] = useState<string | null>(null);
  const dueAtRef = useRef<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState(25);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      if (dueAtRef.current == null) return;
      const remaining = dueAtRef.current - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        setRunning(false);
        setTimerId(null);
        dueAtRef.current = null;
      } else {
        setRemainingMs(remaining);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [running]);

  const applyPreset = (minutes: number) => {
    if (running) return;
    const ms = minutes * 60 * 1000;
    setCustomMinutes(minutes);
    setTotalMs(ms);
    setRemainingMs(ms);
  };

  const handleStart = async () => {
    const dueAt = Date.now() + remainingMs;
    dueAtRef.current = dueAt;
    const item = await addReminder("timer", "Seu timer terminou!", dueAt);
    setTimerId(item.id);
    setRunning(true);
  };

  const handlePause = async () => {
    if (timerId) await removeReminder(timerId);
    setTimerId(null);
    setRunning(false);
  };

  const handleReset = async () => {
    if (timerId) await removeReminder(timerId);
    setTimerId(null);
    setRunning(false);
    setRemainingMs(totalMs);
    dueAtRef.current = null;
  };

  // --- Reminders state ---
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [message, setMessage] = useState("");
  const [dateTime, setDateTime] = useState(defaultDateTimeInput);
  const [reminderError, setReminderError] = useState<string | null>(null);

  useEffect(() => {
    void listReminders().then((all) => setReminders(all.filter((r) => r.kind === "reminder")));
    const unlisten = listen<ReminderItem[]>("reminders-changed", (e) =>
      setReminders(e.payload.filter((r) => r.kind === "reminder")),
    );
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const handleAddReminder = async () => {
    setReminderError(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setReminderError("Digite uma mensagem para o lembrete.");
      return;
    }
    const dueAt = new Date(dateTime).getTime();
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      setReminderError("Escolha uma data e hora no futuro.");
      return;
    }
    await addReminder("reminder", trimmed, dueAt);
    setMessage("");
    setDateTime(defaultDateTimeInput());
  };

  return (
    <div className="panel reminders">
      <TitleBar
        title="Lembretes / Timer"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body rem-body">
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

        {tab === "timer" && (
          <div className="dt-pane rem-timer-pane">
            <div className="rem-clock">{formatClock(remainingMs)}</div>

            <div className="conv-tabs">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`conv-tab${!running && totalMs === p.minutes * 60 * 1000 ? " conv-tab-active" : ""}`}
                  disabled={running}
                  onClick={() => applyPreset(p.minutes)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="settings-row">
              <label className="settings-row-label">Personalizado</label>
              <input
                type="number"
                min={1}
                max={180}
                className="cp-num-input rem-custom-input"
                disabled={running}
                value={customMinutes}
                onChange={(e) => applyPreset(Number(e.target.value) || 1)}
              />
              <span className="settings-row-value">min</span>
            </div>

            <div className="rem-timer-actions">
              {!running ? (
                <button className="var-add-btn" onClick={() => void handleStart()} disabled={remainingMs <= 0}>
                  Iniciar
                </button>
              ) : (
                <button className="var-add-btn" onClick={() => void handlePause()}>
                  Pausar
                </button>
              )}
              <button className="var-add-btn" onClick={() => void handleReset()}>
                Reiniciar
              </button>
            </div>
            <p className="settings-hint">
              Você recebe uma notificação quando o tempo acabar, mesmo com essa janela fechada.
            </p>
          </div>
        )}

        {tab === "reminders" && (
          <div className="dt-pane">
            <textarea
              className="dt-textarea dt-textarea-short"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Do que você quer ser lembrado?"
              spellCheck={false}
            />
            <div className="conv-row">
              <input
                type="datetime-local"
                className="conv-value-input"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
              />
              <button className="var-add-btn" onClick={() => void handleAddReminder()}>
                Adicionar
              </button>
            </div>
            {reminderError && <p className="ocr-error">{reminderError}</p>}

            <div className="rem-list">
              {reminders.length === 0 && (
                <p className="settings-hint rem-empty">Nenhum lembrete agendado.</p>
              )}
              {reminders
                .slice()
                .sort((a, b) => a.due_at - b.due_at)
                .map((r) => (
                  <div className="comp-row" key={r.id}>
                    <div className="comp-row-info">
                      <span className="comp-row-name">{r.message}</span>
                      <span className="comp-row-size">{formatDateTime(r.due_at)}</span>
                    </div>
                    <button
                      className="clip-item-remove"
                      onClick={() => void removeReminder(r.id)}
                      title="Remover"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
