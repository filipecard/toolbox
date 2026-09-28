import { load } from "@tauri-apps/plugin-store";
import type { Variable } from "./engine";

export interface HistoryEntry {
  expression: string;
  result: string;
}

/** Everything the calculator keeps between sessions — so closing it (or
 * the idle-window cleanup destroying it while minimized) loses nothing. */
export interface CalcState {
  expression: string;
  memory: number;
  history: HistoryEntry[];
  variables: Variable[];
}

const KEY = "calculator";

function getStore() {
  return load("store.json", { autoSave: false });
}

export async function loadCalcState(): Promise<Partial<CalcState> | null> {
  const store = await getStore();
  return (await store.get<Partial<CalcState>>(KEY)) ?? null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: typing an expression calls this on every keystroke. */
export function saveCalcState(state: CalcState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void getStore().then(async (store) => {
      await store.set(KEY, state);
      await store.save();
    });
  }, 500);
}
