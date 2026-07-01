import { createContext, useContext } from "react";
import { isFeatureEnabled, type FeatureKey } from "@/lib/features";

interface FeatureFlagsContextValue {
  isEnabled: (key: FeatureKey) => boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  isEnabled: isFeatureEnabled,
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  return (
    <FeatureFlagsContext.Provider value={{ isEnabled: isFeatureEnabled }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}

interface FeatureGateProps {
  feature: FeatureKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function FeatureGate({ feature, fallback = null, children }: FeatureGateProps) {
  const { isEnabled } = useContext(FeatureFlagsContext);
  return isEnabled(feature) ? <>{children}</> : <>{fallback}</>;
}
