import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setPosition } from "./bubbleStore";

/** Persists this window's position (in logical pixels) to the shared store, debounced, whenever it moves. */
export function useWindowMove(storeKey: string, debounceMs = 300) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    appWindow
      .onMoved(({ payload }) => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          void (async () => {
            const scale = await appWindow.scaleFactor();
            void setPosition(storeKey, payload.x / scale, payload.y / scale);
          })();
        }, debounceMs);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [storeKey, debounceMs]);
}
