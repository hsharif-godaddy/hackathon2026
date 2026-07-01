import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { defaultAppConfig, type AppConfig } from "@/lib/app-config";
import { getPublicConfig } from "@/lib/appointments-client";

// Deep-merge helper — lets callers pass only the fields they want to override.
function mergeConfig(base: AppConfig, overrides: DeepPartial<AppConfig>): AppConfig {
  return {
    brand: { ...base.brand, ...(overrides.brand ?? {}) },
    booking: {
      ...base.booking,
      ...(overrides.booking ?? {}),
      // Tuple fields need special handling to preserve the full tuple type.
      steps: (overrides.booking?.steps ?? base.booking.steps) as AppConfig["booking"]["steps"],
    },
    home: { ...base.home, ...(overrides.home ?? {}) },
    admin: { ...base.admin, ...(overrides.admin ?? {}) },
    currency: overrides.currency ?? base.currency,
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const AppConfigContext = createContext<AppConfig>(defaultAppConfig);

interface AppConfigProviderProps {
  children: ReactNode;
  /** Pass only the fields you want to override — defaults fill the rest. */
  config?: DeepPartial<AppConfig>;
}

export function AppConfigProvider({ children, config }: AppConfigProviderProps) {
  const [resolved, setResolved] = useState<AppConfig>(
    config ? mergeConfig(defaultAppConfig, config) : defaultAppConfig,
  );

  // Load currency (and any other business settings) from the public config API
  useEffect(() => {
    getPublicConfig()
      .then(({ config: remote }) => {
        const currency = typeof remote.currency === "string" && remote.currency.length === 3
          ? remote.currency.toUpperCase()
          : undefined;
        if (currency) {
          setResolved(prev => ({ ...prev, currency }));
        }
      })
      .catch(() => {
        // Non-fatal — keep the default currency
      });
  }, []);

  return <AppConfigContext.Provider value={resolved}>{children}</AppConfigContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
