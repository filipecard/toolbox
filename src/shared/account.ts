import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ACCOUNT_CHANGED_EVENT, accountStatus, type AccountStatus } from "./tauri";

/** Live account status, pushed by the Rust side on every change. */
export function useAccountStatus(): AccountStatus {
  const [status, setStatus] = useState<AccountStatus>({ state: "loading" });
  useEffect(() => {
    void accountStatus().then(setStatus);
    const unlisten = listen<AccountStatus>(ACCOUNT_CHANGED_EVENT, (e) => setStatus(e.payload));
    return () => void unlisten.then((f) => f());
  }, []);
  return status;
}
