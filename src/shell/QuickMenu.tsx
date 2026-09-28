import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openFromQuickMenu } from "../shared/tauri";
import { getSettings, onSettingsChanged, type AppSettings } from "../shared/settingsStore";
import { SETTINGS_ICON_SRC, TOOL_CATALOG } from "./toolCatalog";
import { SvgIcon, ToolIcon } from "./ToolIcon";

// Stagger delay between each icon's pop-in animation — see the
// `quick-menu-pop` keyframes in App.css.
const POP_STEP_MS = 35;

// Position syncing with the launcher bubble (opening always re-anchors next
// to it; dragging this bar moves where the bubble reappears next) is handled
// natively in Rust — see open_quick_menu/on_quick_menu_moved in windows.rs.
// That path can tell "we just repositioned this ourselves" apart from a real
// user drag; the frontend's onMoved-based useWindowMove hook can't, so using
// it here would immediately overwrite the bubble's position with the bar's
// own (offset) one on every open.
//
// No title bar here on purpose — just the icon row. Dragging the bar (via
// the background around/between icons, `data-tauri-drag-region`) and
// dismissing it by clicking elsewhere both work without any visible
// minimize/close chrome: clicking outside the bar's window takes native OS
// focus away from it, which windows.rs's Focused(false) handler treats as
// "close this and bring the bubble back."
export function QuickMenu() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Which side Rust decided to open on (see quick_menu_position's
  // `place_right`) — determines which end of the row "starts" the pop-in
  // cascade, so it always reads as growing outward from the bubble.
  const [openRight, setOpenRight] = useState(true);
  // Bumped on every open so React remounts the icon row (fresh DOM nodes),
  // which is what actually restarts the CSS pop-in animation — the window
  // is only ever hidden/shown, never recreated, so without this the
  // animation would only ever play once, the very first time.
  const [animKey, setAnimKey] = useState(0);
  // Blanked right before Rust hides the window (see collapse_quick_menu),
  // so the frame WebView2 keeps while hidden — and flashes on the next
  // show() — is an empty row, not the fully-revealed icons.
  const [closed, setClosed] = useState(false);

  const refresh = () => {
    void getSettings().then(setSettings);
  };

  useEffect(refresh, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onSettingsChanged(setSettings).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("quick-menu-opened", (e) => {
      setOpenRight(e.payload);
      setAnimKey((k) => k + 1);
      setClosed(false);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("quick-menu-closing", () => setClosed(true)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // The bar stays open after picking something; it closes on a click
  // outside it (see open_from_quick_menu).
  const handleSelect = (toolId: string) => {
    void openFromQuickMenu(toolId);
  };

  const items = (settings?.quickMenuItems ?? [])
    .filter((item) => item.enabled)
    .map((item) => ({
      ...item,
      catalog: TOOL_CATALOG.find((t) => t.toolId === item.toolId),
    }))
    .filter((item) => item.catalog);

  // Total icon count (tools + the settings gear) and a helper that turns a
  // 0-based DOM position into "how many steps into the cascade" — reversed
  // when opening left, since then the bar's *right* edge sits against the
  // bubble, so the rightmost (last) icon is the one nearest it and should
  // animate in first.
  const totalCount = items.length + 1;
  const popDelay = (domIndex: number) =>
    `${(openRight ? domIndex : totalCount - 1 - domIndex) * POP_STEP_MS}ms`;

  return (
    <div className="panel quick-menu-bar" data-tauri-drag-region>
      <div className={`quick-menu-strip${closed ? " is-closed" : ""}`} key={animKey}>
        {items.map((item, index) => (
          <button
            key={item.toolId}
            className="quick-menu-item"
            style={{
              background: item.color ?? item.catalog!.color,
              animationDelay: popDelay(index),
            }}
            title={item.label}
            onClick={() => handleSelect(item.toolId)}
          >
            <ToolIcon item={item} catalog={item.catalog!} imgClassName="quick-menu-item-img" />
          </button>
        ))}
        <button
          className="quick-menu-item quick-menu-item-settings"
          style={{ animationDelay: popDelay(items.length) }}
          title="Configurações"
          onClick={() => handleSelect("settings")}
        >
          <SvgIcon src={SETTINGS_ICON_SRC} mono />
        </button>
      </div>
    </div>
  );
}
