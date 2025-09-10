import { useState, useEffect } from 'react';
import { getGasketConfig, gasketConfig, type GasketConfig } from '@/lib/gasket-config';

export interface UseGasketConfigReturn {
  config: GasketConfig;
  isLoading: boolean;
  error: string | null;
  isRuntimeConfig: boolean; // true if using runtime config, false if using static fallback
}

/**
 * Hook to access Gasket configuration with runtime environment support
 *
 * This hook:
 * 1. Immediately returns static config for SSR/initial render
 * 2. Loads runtime config on client-side
 * 3. Updates when runtime config is available
 * 4. Handles loading and error states
 */
export function useGasketConfig(): UseGasketConfigReturn {
  const [config, setConfig] = useState<GasketConfig>(gasketConfig); // Start with static config
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRuntimeConfig, setIsRuntimeConfig] = useState(false);

  useEffect(() => {
    // Only load runtime config on client-side
    if (typeof window === 'undefined') {
      return;
    }

    let canceled = false;

    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const runtimeConfig = await getGasketConfig();

        if (!canceled) {
          setConfig(runtimeConfig);
          setIsRuntimeConfig(true);
        }
      } catch (err) {
        if (!canceled) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load configuration';
          setError(errorMessage);
          console.warn('useGasketConfig: Failed to load runtime config:', err);
          // Keep using static config on error
        }
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      canceled = true;
    };
  }, []);

  return {
    config,
    isLoading,
    error,
    isRuntimeConfig
  };
}

/**
 * Hook for components that need specific config values
 * Returns the requested config section with loading state
 */
export function useGasketConfigSection<K extends keyof GasketConfig>(
  section: K
): UseGasketConfigReturn & { sectionConfig: GasketConfig[K] } {
  const result = useGasketConfig();

  return {
    ...result,
    sectionConfig: result.config[section]
  };
}
