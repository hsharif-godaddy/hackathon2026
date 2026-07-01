/**
 * Unified auth context — cookie-based, provider-agnostic.
 *
 * Replaces CustomerAuthContext. The server owns the session cookie;
 * the client only stores the resolved AuthUser in React state.
 * On mount we call GET /api/auth/me to hydrate from an existing cookie.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface AuthUser {
  id: string;
  identityId: number;
  identityType: "Client" | "Resource" | "Admin";
  roles: ("customer" | "staff" | "admin")[];
  email: string | null;
  displayName: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign up with name + email + password. Throws on failure. */
  signup: (input: SignupInput) => Promise<void>;
  /** Log in with email + password. Throws on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** Clear session cookie and reset state. */
  logout: () => Promise<void>;
}

interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from existing cookie on mount
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ user?: AuthUser }>) : null))
      .then((d) => {
        if (d?.user) setUser(d.user);
      })
      .catch(() => {
        /* ignored */
      })
      .finally(() => setIsLoading(false));
  }, []);

  const signup = useCallback(async (input: SignupInput) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        password: input.password,
      }),
    });
    const data = (await res.json()) as { error?: string; user?: AuthUser };
    if (!res.ok) throw new Error(data.error ?? "Signup failed");
    setUser(data.user ?? null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as { error?: string; user?: AuthUser };
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    setUser(data.user ?? null);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {
      /* ignored */
    });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, signup, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
