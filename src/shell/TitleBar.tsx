import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveRole } from "../bootstrap/resolveRole";
import { getSettings, onSettingsChanged, type QuickMenuItemSetting } from "../shared/settingsStore";
import { SETTINGS_ICON_SRC, TOOL_CATALOG } from "./toolCatalog";
import { SvgIcon, ToolIcon } from "./ToolIcon";

/** Which quick-menu item this window belongs to, from its label — so every
 * window's header shows that item's icon and color without each tool
 * having to pass them in. */
function windowToolId(): string | null {
  const role = resolveRole(getCurrentWindow().label);
  if (role.kind === "tool") return role.toolId;
  if (role.kind === "notes-bar" || role.kind === "note") return "notes";
  return null;
}

/** The window's quick-menu item as customized in Settings (icon, color),
 * kept live as Settings changes. */
function useToolItem(toolId: string | null): QuickMenuItemSetting | null {
  const [item, setItem] = useState<QuickMenuItemSetting | null>(null);
  useEffect(() => {
    if (!toolId || toolId === "settings") return;
    const pick = (items: QuickMenuItemSetting[]) =>
      setItem(items.find((i) => i.toolId === toolId) ?? null);
    void getSettings().then((s) => pick(s.quickMenuItems));
    const unlisten = onSettingsChanged((s) => pick(s.quickMenuItems));
    return () => void unlisten.then((f) => f());
  }, [toolId]);
  return item;
}

export function TitleBar({
  title,
  onMinimize,
  onClose,
  children,
}: {
  title: string;
  onMinimize: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [toolId] = useState(windowToolId);
  const item = useToolItem(toolId);
  const catalog = toolId ? TOOL_CATALOG.find((t) => t.toolId === toolId) : undefined;

  let color: string | undefined;
  let icon: ReactNode = null;
  if (toolId === "settings") {
    color = "var(--theme-button-strong)";
    icon = <SvgIcon src={SETTINGS_ICON_SRC} mono />;
  } else if (catalog) {
    color = item?.color ?? catalog.color;
    icon = (
      <ToolIcon
        item={item ?? { toolId: catalog.toolId, label: catalog.defaultLabel, enabled: true }}
        catalog={catalog}
        imgClassName="titlebar-icon-img"
      />
    );
  }

  return (
    <div
      className={`titlebar${color ? " titlebar-tagged" : ""}`}
      style={color ? { ["--titlebar-tag" as string]: color } : undefined}
      data-tauri-drag-region
    >
      <span className="titlebar-heading">
        {icon && (
          <span className="titlebar-icon" style={{ background: color }}>
            {icon}
          </span>
        )}
        <span className="titlebar-title">{title}</span>
      </span>
      <div className="titlebar-actions">
        {children}
        <button className="titlebar-btn" onClick={onMinimize} title="Minimizar">
          &#8211;
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={onClose} title="Fechar">
          &times;
        </button>
      </div>
    </div>
  );
}
