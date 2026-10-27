import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  applyShortcuts,
  dependencyStatus,
  installDependency,
  setupWhisper,
  whisperSetupStatus,
  type DependencyProgress,
} from "../shared/tauri";
import { isInstalled, type AppSettings } from "../shared/settingsStore";
import { TOOL_CATALOG } from "./toolCatalog";
import { ToolIcon } from "./ToolIcon";

/** The heavy part some tools need, downloaded apart from the app. */
interface Component {
  label: string;
  approxMb: number;
  ready: () => Promise<boolean>;
  download: () => Promise<unknown>;
}

const COMPONENTS: Record<string, Component> = {
  ocr: {
    label: "Motor de leitura (Tesseract)",
    approxMb: 60,
    ready: () => dependencyStatus("tesseract").then((s) => s.installed),
    download: () => installDependency("tesseract"),
  },
  transcribe: {
    label: "Reconhecedor de voz (whisper.cpp + modelo)",
    approxMb: 150,
    ready: () => whisperSetupStatus().then((s) => s.ready),
    download: () => setupWhisper(),
  },
};

type ComponentState = "checking" | "ready" | "missing" | "downloading";

/** Settings → Ferramentas: what is installed on this computer. Like an
 * installer's "modify" screen — removing a tool takes it out of everything
 * (quick menu, shortcuts, windows) and deletes the components it
 * downloaded; installing one downloads its component right away. */
export function ToolsSection({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (next: AppSettings) => void;
}) {
  const [components, setComponents] = useState<Record<string, ComponentState>>({});
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [showAvailable, setShowAvailable] = useState(false);

  const setComponent = (toolId: string, state: ComponentState) =>
    setComponents((c) => ({ ...c, [toolId]: state }));
  const setError = (toolId: string, message: string | null) =>
    setErrors(({ [toolId]: _old, ...rest }) => (message ? { ...rest, [toolId]: message } : rest));

  const check = useCallback((toolId: string) => {
    const component = COMPONENTS[toolId];
    if (!component) return;
    void component
      .ready()
      .then((ready) => setComponent(toolId, ready ? "ready" : "missing"))
      .catch(() => setComponent(toolId, "missing"));
  }, []);

  useEffect(() => {
    Object.keys(COMPONENTS).forEach(check);
    const offDep = listen<DependencyProgress>("dependency-progress", (e) => {
      if (e.payload.id === "tesseract" && e.payload.total > 0) {
        setProgress((p) => ({ ...p, ocr: Math.round((e.payload.downloaded / e.payload.total) * 100) }));
      }
    });
    const offWhisper = listen<{ stage: string; percent: number | null }>("whisper-setup-progress", (e) =>
      setProgress((p) => ({ ...p, transcribe: e.payload.percent === null ? null : Math.round(e.payload.percent) })),
    );
    return () => {
      void offDep.then((f) => f());
      void offWhisper.then((f) => f());
    };
  }, [check]);

  const downloadComponent = async (toolId: string) => {
    const component = COMPONENTS[toolId];
    if (!component) return;
    setError(toolId, null);
    setProgress((p) => ({ ...p, [toolId]: null }));
    setComponent(toolId, "downloading");
    try {
      await component.download();
      setComponent(toolId, "ready");
    } catch (e) {
      setComponent(toolId, "missing");
      setError(toolId, String(e));
    }
  };

  const setInstalled = (toolId: string, installed: boolean) => {
    const shortcuts = { ...settings.shortcuts };
    if (!installed && shortcuts[toolId]) {
      delete shortcuts[toolId];
      void applyShortcuts(shortcuts);
    }
    update({
      ...settings,
      shortcuts,
      quickMenuItems: settings.quickMenuItems.map((i) =>
        i.toolId === toolId ? { ...i, installed, enabled: installed } : i,
      ),
    });
  };

  const install = (toolId: string) => {
    setInstalled(toolId, true);
    if (components[toolId] === "missing") void downloadComponent(toolId);
  };

  const remove = async (toolId: string) => {
    setConfirming(null);
    setInstalled(toolId, false);
    try {
      await invoke("remove_tool_components", { toolId });
    } catch (e) {
      setError(toolId, String(e));
    }
    check(toolId);
  };

  const rows = settings.quickMenuItems
    .map((item) => ({ item, catalog: TOOL_CATALOG.find((t) => t.toolId === item.toolId) }))
    .filter((r): r is { item: typeof r.item; catalog: NonNullable<typeof r.catalog> } => !!r.catalog);
  const installed = rows.filter((r) => isInstalled(r.item));
  const available = rows.filter((r) => !isInstalled(r.item));

  const componentLine = (toolId: string, isToolInstalled: boolean) => {
    const component = COMPONENTS[toolId];
    if (!component) return null;
    const state = components[toolId] ?? "checking";
    const percent = progress[toolId];
    if (state === "downloading") {
      return (
        <div className="tools-component">
          <span>
            Baixando {component.label.toLowerCase()}
            {percent != null ? ` — ${percent}%` : "…"}
          </span>
          {percent != null && (
            <div className="dep-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      );
    }
    if (!isToolInstalled) {
      return <span className="tools-component">+ {component.label} (~{component.approxMb} MB)</span>;
    }
    if (state === "ready") return <span className="tools-component tools-component-ok">✓ {component.label}</span>;
    if (state === "missing") {
      return (
        <span className="tools-component tools-component-missing">
          Falta baixar: {component.label} (~{component.approxMb} MB)
          <button className="var-add-btn" onClick={() => void downloadComponent(toolId)}>
            Baixar
          </button>
        </span>
      );
    }
    return null;
  };

  const renderRow = ({ item, catalog }: (typeof rows)[number], isToolInstalled: boolean) => {
    const busy = components[item.toolId] === "downloading";
    return (
      <div key={item.toolId} className="tools-row">
        <div className="tools-row-main">
          <span className="settings-item-icon" style={{ background: item.color ?? catalog.color }}>
            <ToolIcon item={item} catalog={catalog} imgClassName="settings-item-icon-img" />
          </span>
          <div className="tools-row-text">
            <span className="tools-row-name">{catalog.defaultLabel}</span>
            <span className="tools-row-desc">{catalog.description}</span>
          </div>
          {isToolInstalled ? (
            <button
              className="var-add-btn"
              disabled={busy}
              onClick={() => setConfirming(confirming === item.toolId ? null : item.toolId)}
            >
              Remover
            </button>
          ) : (
            <button className="var-add-btn tools-install-btn" onClick={() => install(item.toolId)}>
              Instalar
            </button>
          )}
        </div>
        {componentLine(item.toolId, isToolInstalled)}
        {confirming === item.toolId && (
          <div className="tools-confirm">
            <span>
              Remover {catalog.defaultLabel} deste computador?
              {COMPONENTS[item.toolId] && " Os componentes baixados serão apagados."} Seus dados ficam guardados
              caso instale de novo.
            </span>
            <div className="tools-confirm-actions">
              <button className="var-add-btn tools-remove-btn" onClick={() => void remove(item.toolId)}>
                Remover
              </button>
              <button className="var-add-btn" onClick={() => setConfirming(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {errors[item.toolId] && <p className="ocr-error">{errors[item.toolId]}</p>}
      </div>
    );
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Ferramentas</h3>
      <p className="settings-hint">
        Instale só o que você usa. Ferramentas removidas somem do menu rápido, dos atalhos e liberam o
        espaço dos componentes que baixaram.
      </p>
      <div className="tools-list">
        {installed.length === 0 && <p className="settings-hint">Nenhuma ferramenta instalada.</p>}
        {installed.map((r) => renderRow(r, true))}
      </div>
      {available.length > 0 && (
        <>
          <button className="tools-available-toggle" onClick={() => setShowAvailable((v) => !v)}>
            {showAvailable ? "▾" : "▸"} Disponíveis para instalar ({available.length})
          </button>
          {showAvailable && <div className="tools-list">{available.map((r) => renderRow(r, false))}</div>}
        </>
      )}
    </section>
  );
}
