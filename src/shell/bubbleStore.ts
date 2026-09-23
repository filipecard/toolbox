import { load, Store } from "@tauri-apps/plugin-store";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("store.json", { autoSave: false });
  }
  return storePromise;
}

export async function getPosition(key: string): Promise<[number, number] | null> {
  const store = await getStore();
  const value = await store.get<[number, number]>(key);
  return value ?? null;
}

export async function setPosition(key: string, x: number, y: number): Promise<void> {
  const store = await getStore();
  await store.set(key, [x, y]);
  await store.save();
}
