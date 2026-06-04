import { type GasketData, gasketData } from '@gasket/data';

/**
 * Hivemind experiment cohort assignment
 *
 * When a user is assigned to a Hivemind experiment, they receive a cohort ID
 * and any associated experiment data.
 */
export interface HivemindExperiment {
  /** The cohort ID the user is assigned to (e.g., 'control', 'treatment_a') */
  cohortId: string;
  /** Experiment-specific data configured in Hivemind */
  data?: Record<string, unknown>;
}

/**
 * Switchboard configuration data exposed to the client
 *
 * Contains feature flags from Switchboard and Hivemind experiment assignments.
 * All data exposed here should be browser-safe (no server secrets).
 */
export interface SwitchboardData {
  /** Feature flags from Switchboard (keyed by flag name) */
  [key: string]: unknown;
}

declare module '@gasket/data' {
  interface GasketData {
    cds?: {
      componentTypes?: string[];
      api?: {
        baseUrl?: string;
        logPath?: string;
      };
      appName?: string;
      enabledRoutes?: string[];
      proxyLogPath?: string;
      depsPath?: string;
      [key: string]: unknown;
    };
    /** Internationalization data from @gasket/plugin-intl */
    intl?: {
      locale: string;
    };
    /**
     * Switchboard configuration and Hivemind experiments
     *
     * Populated by @godaddy/gasket-plugin-switchboard when enableGasketData is true.
     * Contains feature flags and Hivemind experiment assignments.
     *
     * @example
     * ```tsx
     * const { switchboard } = useGasketData();
     * if (switchboard?.['my-feature-flag']) {
     *   // Feature is enabled
     * }
     *
     * // Access Hivemind experiment
     * const experiment = switchboard?.['my-experiment'] as HivemindExperiment;
     * if (experiment?.cohortId === 'treatment') {
     *   // User is in treatment group
     * }
     * ```
     */
    switchboard?: SwitchboardData;
    /**
     * Pusher real-time messaging configuration
     *
     * Populated from gasket.ts configuration.
     * Contains Pusher API key and cluster for client-side connections.
     *
     * @example
     * ```tsx
     * const { pusher } = useGasketData();
     * const client = new Pusher(pusher?.apiKey, {
     *   cluster: pusher?.cluster
     * });
     * ```
     */
    pusher?: {
      apiKey: string;
      cluster: string;
    };
  }
}

declare global {
  interface Window {
    gasketData?: GasketData;
  }
}

export function useGasketData(): GasketData {
  if (typeof window === 'undefined') {
    return {};
  }

  if (typeof window.gasketData === 'undefined') {
    window.gasketData = gasketData();
  }

  return window.gasketData || {};
}

