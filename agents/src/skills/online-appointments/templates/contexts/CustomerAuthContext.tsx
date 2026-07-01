import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface CustomerProfile {
  client_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface CustomerAuthState {
  profile: CustomerProfile | null;
  isAuthenticated: boolean;
  lookupByEmail: (email: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "customer_profile";

const CustomerAuthContext = createContext<CustomerAuthState | null>(null);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as CustomerProfile) : null;
  });

  const lookupByEmail = useCallback(async (email: string) => {
    const res = await fetch(`/api/appointments/customer/lookup?email=${encodeURIComponent(email)}`);
    if (res.status === 404) {
      throw new Error("No account found for that email. Please make a booking first.");
    }
    if (!res.ok) {
      throw new Error("Failed to look up account. Please try again.");
    }
    const data = (await res.json()) as CustomerProfile;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setProfile(data);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfile(null);
  }, []);

  return (
    <CustomerAuthContext.Provider
      value={{ profile, isAuthenticated: !!profile, lookupByEmail, logout }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCustomerAuth(): CustomerAuthState {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) throw new Error("useCustomerAuth must be used within CustomerAuthProvider");
  return ctx;
}
