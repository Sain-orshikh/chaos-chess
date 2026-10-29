"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, type User } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  checking: boolean;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
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
