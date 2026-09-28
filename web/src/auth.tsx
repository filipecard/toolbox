import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthResponse, Me } from "@toolbox/shared";
import { api, refreshSession, setAccessToken, setSessionLostHandler } from "./api";

interface AuthState {
  /** null = signed out; undefined = still checking the session on load. */
  me: Me | null | undefined;
  /** After login/signup: stores the token and loads the account. */
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const reload = useCallback(async () => {
    setMe(await api.me());
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setMe(null));
    // Restores the session from the refresh cookie, if there is one.
    void refreshSession().then(async (auth) => {
      if (!auth) return setMe(null);
      try {
        setMe(await api.me());
      } catch {
        setMe(null);
      }
    });
  }, []);

  const signIn = useCallback(
    async (auth: AuthResponse) => {
      setAccessToken(auth.accessToken);
      await reload();
    },
    [reload],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setMe(null);
    }
  }, []);

  const value = useMemo(() => ({ me, signIn, signOut, reload }), [me, signIn, signOut, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
