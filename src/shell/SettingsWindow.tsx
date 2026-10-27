import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./TitleBar";
import { IconPicker } from "./IconPicker";
import { collapseTool, listSystemFonts } from "../shared/tauri";
import {
  getSettings,
  onSettingsReplaced,
  saveSettings,
  DEFAULT_BUBBLE_COLOR,
  DEFAULT_BUBBLE_OPACITY,
  DEFAULT_BUBBLE_SIZE,
  DEFAULT_THEME,
  THEME_PRESETS,
  isInstalled,
  withVisualDefaults,
  type AppSettings,
  type AppTheme,
} from "../shared/settingsStore";
import { SETTINGS_ICON_SRC, TOOL_CATALOG } from "./toolCatalog";
import { SvgIcon, ToolIcon } from "./ToolIcon";
import { ShortcutsSection } from "./ShortcutsSection";
import { BackupSection } from "./BackupSection";
import { AccountSection } from "./AccountSection";
import { StartupSection } from "./StartupSection";
import { ToolsSection } from "./ToolsSection";

const THEME_FIELDS: {
  key: "background" | "text" | "header" | "button" | "input" | "accent";
  opacityKey:
    | "backgroundOpacity"
    | "textOpacity"
    | "headerOpacity"
    | "buttonOpacity"
    | "inputOpacity"
    | "accentOpacity";
  label: string;
}[] = [
  { key: "background", opacityKey: "backgroundOpacity", label: "Fundo" },
  { key: "text", opacityKey: "textOpacity", label: "Texto (todos)" },
  { key: "header", opacityKey: "headerOpacity", label: "Cabeçalho" },
  { key: "button", opacityKey: "buttonOpacity", label: "Botões" },
  { key: "input", opacityKey: "inputOpacity", label: "Campos de texto" },
  { key: "accent", opacityKey: "accentOpacity", label: "Destaque (botão fechar)" },
];

export function SettingsWindow() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const dragIndex = useRef<number | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    void getSettings().then(setSettings);
    // Picks up changes made elsewhere (a backup import) so this window's
    // next edit doesn't write its stale copy back over them.
    const unlisten = onSettingsReplaced(setSettings);
    void listSystemFonts()
      .then(setSystemFonts)
      .catch(() => setSystemFonts([]));
    return () => void unlisten.then((f) => f());
  }, []);

  const update = (next: AppSettings) => {
    setSettings(next);
    void saveSettings(next);
  };

  if (!settings) {
    return (
      <div className="panel settings-window">
        <TitleBar
          title="Configurações"
          onMinimize={() => void collapseTool("settings")}
          onClose={() => void getCurrentWindow().close()}
        />
      </div>
    );
  }

  const setItemEnabled = (toolId: string, enabled: boolean) => {
    update({
      ...settings,
      quickMenuItems: settings.quickMenuItems.map((i) =>
        i.toolId === toolId ? { ...i, enabled } : i,
      ),
    });
  };

  const setItemLabel = (toolId: string, label: string) => {
    update({
      ...settings,
      quickMenuItems: settings.quickMenuItems.map((i) =>
        i.toolId === toolId ? { ...i, label } : i,
      ),
    });
  };

  const reorder = (fromIndex: number, toIndex: number) => {
    const next = [...settings.quickMenuItems];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    update({ ...settings, quickMenuItems: next });
  };

  const setItemIcon = (toolId: string, icon: string | undefined, iconImage: string | undefined) => {
    update({
      ...settings,
      quickMenuItems: settings.quickMenuItems.map((i) =>
        i.toolId === toolId ? { ...i, icon, iconImage } : i,
      ),
    });
  };

  const setItemColor = (toolId: string, color: string) => {
    update({
      ...settings,
      quickMenuItems: settings.quickMenuItems.map((i) =>
        i.toolId === toolId ? { ...i, color } : i,
      ),
    });
  };

  const setThemeField = <K extends keyof AppTheme>(key: K, value: AppTheme[K]) => {
    update({ ...settings, theme: { ...settings.theme, [key]: value } });
  };

  return (
    <div className="panel settings-window">
      <TitleBar
        title="Configurações"
        onMinimize={() => void collapseTool("settings")}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="settings-body">
        <AccountSection />

        <ToolsSection settings={settings} update={update} />

        <section className="settings-section">
          <h3 className="settings-heading">Itens do menu rápido</h3>
          <div className="settings-item-list">
            {settings.quickMenuItems.map((item, index) => {
              const catalog = TOOL_CATALOG.find((t) => t.toolId === item.toolId);
              if (!catalog || !isInstalled(item)) return null;
              return (
                <div
                  key={item.toolId}
                  className="settings-item-row"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex.current !== null && dragIndex.current !== index) {
                      reorder(dragIndex.current, index);
                    }
                    dragIndex.current = null;
                  }}
                >
                  <span
                    className="settings-item-drag"
                    draggable
                    onDragStart={(e) => {
                      dragIndex.current = index;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(index));
                    }}
                    title="Arrastar para reordenar"
                  >
                    ⋮⋮
                  </span>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => setItemEnabled(item.toolId, e.target.checked)}
                    title="Mostrar no menu rápido"
                  />
                  <button
                    className="settings-item-icon"
                    style={{ background: item.color ?? catalog.color }}
                    onClick={() => setIconPickerFor(item.toolId)}
                    title="Alterar ícone"
                  >
                    <ToolIcon item={item} catalog={catalog} imgClassName="settings-item-icon-img" />
                  </button>
                  <input
                    className="settings-item-color"
                    type="color"
                    value={item.color ?? catalog.color}
                    onChange={(e) => setItemColor(item.toolId, e.target.value)}
                    title="Cor do ícone"
                  />
                  <input
                    className="settings-item-label"
                    value={item.label}
                    onChange={(e) => setItemLabel(item.toolId, e.target.value)}
                  />
                </div>
              );
            })}
            <div className="settings-item-row settings-item-row-fixed">
              <span className="settings-item-drag settings-item-drag-fixed" title="Item fixo">
                🔒
              </span>
              <input
                type="checkbox"
                checked
                disabled
                title="Configurações sempre aparece no menu rápido"
              />
              <span className="settings-item-icon settings-item-icon-fixed">
                <SvgIcon src={SETTINGS_ICON_SRC} mono />
              </span>
              <span className="settings-item-label settings-item-label-fixed">Configurações</span>
            </div>
          </div>
          <p className="settings-hint">
            "Configurações" é fixo — sempre aparece no menu rápido e não pode ser desmarcado,
            recolorido ou reordenado.
          </p>
        </section>

        <section className="settings-section">
          <h3 className="settings-heading">Aparência da bolinha</h3>
          <div className="settings-row">
            <label className="settings-row-label">Tamanho</label>
            <input
              type="range"
              min={40}
              max={100}
              step={4}
              value={settings.bubbleSize}
              onChange={(e) => update({ ...settings, bubbleSize: Number(e.target.value) })}
            />
            <span className="settings-row-value">{settings.bubbleSize}px</span>
          </div>
          <div className="settings-row">
            <label className="settings-row-label">Cor</label>
            <input
              type="color"
              value={settings.bubbleColor}
              onChange={(e) => update({ ...settings, bubbleColor: e.target.value })}
            />
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.bubbleOpacity}
              onChange={(e) => update({ ...settings, bubbleOpacity: Number(e.target.value) })}
              title="Opacidade"
            />
            <span className="settings-row-value">
              {Math.round(settings.bubbleOpacity * 100)}%
            </span>
          </div>
          <div className="settings-row">
            <button
              className="var-add-btn"
              onClick={() =>
                update({
                  ...settings,
                  bubbleSize: DEFAULT_BUBBLE_SIZE,
                  bubbleColor: DEFAULT_BUBBLE_COLOR,
                  bubbleOpacity: DEFAULT_BUBBLE_OPACITY,
                })
              }
            >
              Restaurar padrão
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-heading">Tema</h3>
          <p className="settings-hint">
            Uma paleta base aplicada em toda a aplicação — janelas, cabeçalhos, botões e
            todos os textos derivam dessas cores. Escolha um tema pronto ou ajuste abaixo.
          </p>
          <div className="theme-presets">
            {settings.customTheme && (
              <button
                className="theme-preset theme-preset-custom"
                style={{ background: settings.customTheme.background, color: settings.customTheme.text }}
                onClick={() => update({ ...settings, theme: settings.customTheme! })}
                title="Aplicar o tema que você salvou"
              >
                <span className="theme-preset-bar" style={{ background: settings.customTheme.header }} />
                <span className="theme-preset-label">★ Meu tema</span>
                <span className="theme-preset-dots">
                  <span style={{ background: settings.customTheme.button }} />
                  <span style={{ background: settings.customTheme.accent }} />
                </span>
              </button>
            )}
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="theme-preset"
                style={{ background: preset.colors.background, color: preset.colors.text }}
                onClick={() => update({ ...settings, theme: { ...settings.theme, ...preset.colors } })}
                title={`Aplicar tema ${preset.label}`}
              >
                <span className="theme-preset-bar" style={{ background: preset.colors.header }} />
                <span className="theme-preset-label">{preset.label}</span>
                <span className="theme-preset-dots">
                  <span style={{ background: preset.colors.button }} />
                  <span style={{ background: preset.colors.accent }} />
                </span>
              </button>
            ))}
          </div>
          {THEME_FIELDS.map((field) => (
            <div className="settings-row" key={field.key}>
              <label className="settings-row-label">{field.label}</label>
              <input
                type="color"
                value={settings.theme[field.key]}
                onChange={(e) => setThemeField(field.key, e.target.value)}
              />
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={settings.theme[field.opacityKey]}
                onChange={(e) => setThemeField(field.opacityKey, Number(e.target.value))}
                title="Opacidade"
              />
              <span className="settings-row-value">
                {Math.round(settings.theme[field.opacityKey] * 100)}%
              </span>
            </div>
          ))}
          <div className="settings-row">
            <label className="settings-row-label">Fonte</label>
            <select
              className="settings-item-label"
              value={settings.theme.fontFamily}
              onChange={(e) => setThemeField("fontFamily", e.target.value)}
            >
              {!systemFonts.includes(settings.theme.fontFamily) && (
                <option value={settings.theme.fontFamily}>{settings.theme.fontFamily}</option>
              )}
              {systemFonts.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-row-label">Tamanho da fonte</label>
            <input
              type="range"
              min={0.8}
              max={1.6}
              step={0.05}
              value={settings.theme.fontSizeScale}
              onChange={(e) => setThemeField("fontSizeScale", Number(e.target.value))}
            />
            <span className="settings-row-value">
              {Math.round(settings.theme.fontSizeScale * 100)}%
            </span>
          </div>
          <div className="settings-row">
            <label className="settings-row-label">Tam. da UI</label>
            <input
              type="range"
              min={0.85}
              max={1.4}
              step={0.05}
              value={settings.theme.fontScale}
              onChange={(e) => setThemeField("fontScale", Number(e.target.value))}
            />
            <span className="settings-row-value">
              {Math.round(settings.theme.fontScale * 100)}%
            </span>
          </div>
          <div className="settings-row">
            <button className="var-add-btn" onClick={() => update({ ...settings, theme: DEFAULT_THEME })}>
              Restaurar padrão
            </button>
            <button
              className="var-add-btn"
              onClick={() => update({ ...settings, customTheme: settings.theme })}
              title="Guarda cores, opacidades, fonte e tamanhos atuais no bloco &quot;Meu tema&quot;"
            >
              {settings.customTheme ? "Atualizar meu tema" : "Salvar como meu tema"}
            </button>
            {settings.customTheme && (
              <button
                className="var-add-btn"
                onClick={() => update({ ...settings, customTheme: undefined })}
              >
                Excluir meu tema
              </button>
            )}
          </div>
          <p className="settings-hint">
            "Salvar como meu tema" guarda tudo desta seção (cores, opacidades, fonte e tamanhos).
            Depois é só clicar em "★ Meu tema" para voltar a ele.
          </p>
        </section>

        <StartupSection />

        <ShortcutsSection settings={settings} update={update} />

        <BackupSection />

        <section className="settings-section">
          <h3 className="settings-heading">Restaurar tudo</h3>
          <p className="settings-hint">
            Volta cores dos ícones, bolinha e tema para o padrão da aplicação. Ordem, nomes,
            itens visíveis e ícones personalizados são mantidos.
          </p>
          <div className="settings-row">
            <button className="var-add-btn" onClick={() => update(withVisualDefaults(settings))}>
              Restaurar aparência padrão
            </button>
          </div>
        </section>
      </div>

      {iconPickerFor && (
        <IconPicker
          onClose={() => setIconPickerFor(null)}
          onSelectEmoji={(emoji) => {
            setItemIcon(iconPickerFor, emoji, undefined);
            setIconPickerFor(null);
          }}
          onSelectImage={(img) => {
            setItemIcon(iconPickerFor, undefined, img);
            setIconPickerFor(null);
          }}
          onReset={() => {
            setItemIcon(iconPickerFor, undefined, undefined);
            setIconPickerFor(null);
          }}
        />
      )}
    </div>
  );
}
