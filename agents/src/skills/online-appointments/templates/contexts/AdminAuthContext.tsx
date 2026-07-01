import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AdminAuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Returns true if admin has been configured, false if setup is needed. */
  checkSetupRequired: () => Promise<boolean>;
}

const STORAGE_KEY = "admin_token";

const AdminAuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY),
  );

  const checkSetupRequired = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/appointments/admin/auth/setup");
    if (!res.ok) return false;
    const data = (await res.json()) as { ready?: boolean };
    return !data.ready;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/appointments/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Invalid credentials");
    }
    const { token: newToken } = (await res.json()) as { token: string };
    localStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/appointments/admin/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {
      /* ignored */
    });
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }, [token]);

  return (
    <AdminAuthContext.Provider
      value={{ token, isAuthenticated: !!token, login, logout, checkSetupRequired }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function adminFetch(
  url: string,
  token: string | null,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}
