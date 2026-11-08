"use client";

import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiError, type User } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  checking: boolean;
  setUser: Dispatch<SetStateAction<User | null>>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const userId = user?._id;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const heartbeat = () => { if (document.visibilityState === "visible") void api("/matchmaking/presence", {}, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])).catch(() => {}); };
    heartbeat();
    const timer = setInterval(heartbeat, 30_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    api<User>("/auth/me", undefined, controller.signal)
      .then(setUser)
      .catch((error: unknown) => { if (error instanceof ApiError && error.status === 401) setUser(null); })
      .finally(() => { clearTimeout(timeout); setChecking(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);
  const signOut = useCallback(async () => { await api("/auth/logout", {}); setUser(null); }, []);
  return <AuthContext value={{ user, checking, setUser, signOut }}>{children}</AuthContext>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth requires AuthProvider");
  return auth;
}
