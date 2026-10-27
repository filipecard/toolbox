import { useCallback, useEffect, useRef, useState } from "react";
import { applyInstallerSetup } from "../shared/installerSetup";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWindowMove } from "./useWindowMove";
import { expandTool, openNotesBar, openQuickMenu, setBubbleSize } from "../shared/tauri";
import {
  DEFAULT_BUBBLE_COLOR,
  DEFAULT_BUBBLE_OPACITY,
  DEFAULT_BUBBLE_SIZE,
  getSettings,
  onSettingsChanged,
  type AppSettings,
} from "../shared/settingsStore";
import { LAUNCHER_ICON_SRC, TOOL_CATALOG } from "./toolCatalog";
import { SvgIcon } from "./ToolIcon";

/** Legacy per-tool bubbles (only the launcher is still created) just
 * borrow their tool's catalog color and emoji. */
function legacyBubble(toolId: string) {
  return TOOL_CATALOG.find((t) => t.toolId === toolId);
}

const DRAG_THRESHOLD = 4;

export function Bubble({ toolId }: { toolId: string }) {
  useWindowMove(`bubble.${toolId}.pos`);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const [size, setSize] = useState(DEFAULT_BUBBLE_SIZE);
  const [color, setColor] = useState(
    toolId === "launcher" ? DEFAULT_BUBBLE_COLOR : (legacyBubble(toolId)?.color ?? "#888"),
  );
  const [opacity, setOpacity] = useState(DEFAULT_BUBBLE_OPACITY);

  // Only the launcher bubble is user-customizable (it's the only one that's
  // actually a persistent on-screen icon — the others are legacy per-tool
  // bubble ids that aren't created anymore, kept only as a fallback).
  // First start after installing: the installer's tools and theme.
  useEffect(() => {
    if (toolId === "launcher") void applyInstallerSetup().catch(() => {});
  }, [toolId]);

  useEffect(() => {
    if (toolId !== "launcher") return;
    const apply = (s: AppSettings) => {
      setSize(s.bubbleSize);
      setColor(s.bubbleColor);
      setOpacity(s.bubbleOpacity);
    };
    void getSettings().then(apply);
    let unlisten: (() => void) | undefined;
    void onSettingsChanged(apply).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [toolId]);

  // Goes through a dedicated Rust command (rather than calling
  // getCurrentWindow().setSize() directly) so the resize can be nudged to
  // force WebView2 to actually repaint at the new bounds — see
  // set_bubble_size in src-tauri for why a plain setSize() call left the
  // window's rendered surface clipped to its previous size on Windows.
  useEffect(() => {
    if (toolId !== "launcher") return;
    void setBubbleSize(size);
  }, [toolId, size]);

  const handleAction = useCallback(() => {
    if (toolId === "launcher") {
      void openQuickMenu();
    } else if (toolId === "notes") {
      void openNotesBar();
    } else {
      void expandTool(toolId);
    }
  }, [toolId]);

  // Tauri's `data-tauri-drag-region` + native onClick combo can require two
  // clicks to register on an unfocused always-on-top window. Tracking the
  // press/release ourselves and driving the drag through startDragging()
  // makes a single click reliably open the bubble.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    downPos.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!downPos.current || dragging.current) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging.current = true;
      void getCurrentWindow().startDragging();
    }
  };

  const handlePointerUp = () => {
    if (downPos.current && !dragging.current) {
      handleAction();
    }
    downPos.current = null;
    dragging.current = false;
  };

  return (
    <div
      className="bubble"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: size,
        height: size,
        background: color,
        opacity,
        fontSize: size * 0.44,
      }}
      title="ToolBox"
    >
      <span className="bubble-icon">
        {toolId === "launcher" ? <SvgIcon src={LAUNCHER_ICON_SRC} mono /> : (legacyBubble(toolId)?.icon ?? "•")}
      </span>
    </div>
  );
}
