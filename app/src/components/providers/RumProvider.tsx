'use client';

import { useEffect } from 'react';

import { logger } from '@/lib/request-context';

// User-level activation rates per environment.
// Only this percentage of page loads will initialize RUM at all,
// eliminating all HTTP traffic (events, retries, errors) for the rest.
// transactionSampleRate alone does NOT reduce request count — it only
// controls whether span details are included in the payload.
const VALID_ENVIRONMENTS = new Set(['production', 'test', 'development']);

const ACTIVATION_RATES: Record<RumEnvironment, number> = {
  production: 0.05,
  test: 0.1,
  development: 1.0,
};

export type RumEnvironment = 'production' | 'test' | 'development';

// Environment and server URL are set from gasket.ts per-environment config,
// exposed to the client via next.config.js env option.
export function detectEnvironment(): RumEnvironment {
  const environment = process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT || 'development';
  if (!VALID_ENVIRONMENTS.has(environment)) {
    logger.warn('rum.provider.unknown.environment', { environment });
  }
  return environment as RumEnvironment;
}

export function detectServerUrl(): string {
  return process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL || '';
}

/**
 * Elastic APM Real User Monitoring (RUM) Provider
 *
 * Initializes the Elastic APM RUM agent for client-side monitoring.
 * This component should be mounted once at the root of the application
 * to enable performance monitoring, error tracking, and user interaction tracking.
 *
 * **User-level sampling**: Uses the `active` flag to only initialize RUM for
 * a percentage of page loads. This eliminates ALL HTTP traffic (events, retries,
 * errors) for inactive sessions — unlike `transactionSampleRate` which still
 * sends unsampled transaction events to the server.
 *
 * Activation rates:
 * - Production: 5% of users
 * - Test: 10% of users
 * - Development/local: 100% (disable with NEXT_PUBLIC_ELASTIC_APM_ACTIVE=false)
 *
 * Environment and APM server URL are configured per Gasket environment in
 * gasket.ts (elasticApm section) and exposed to the client via next.config.js.
 *
 * Configuration overrides via environment variables:
 * - NEXT_PUBLIC_ELASTIC_APM_SERVER_URL: APM server endpoint
 * - NEXT_PUBLIC_ELASTIC_APM_SERVICE_NAME: Service identifier (default: 'airo-app-builder-frontend')
 * - NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT: Environment name
 * - NEXT_PUBLIC_ELASTIC_APM_ACTIVE: Force enable/disable ('true'/'false')
 */
export default function RumProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const environment = detectEnvironment();
    const activationRate = ACTIVATION_RATES[environment] ?? 0;

    // NEXT_PUBLIC_ELASTIC_APM_ACTIVE overrides automatic activation logic.
    // 'true' → force enable; 'false' → force disable; absent → use activation rate.
    const forceActive = process.env.NEXT_PUBLIC_ELASTIC_APM_ACTIVE;
    const isActive = forceActive === 'false'
      ? false
      : forceActive === 'true'
        ? true
        : Math.random() < activationRate;

    if (!isActive) return;

    const initRum = async () => {
      try {
        const { init: initApm } = await import('@elastic/apm-rum');

        const apm = initApm({
          serviceName: process.env.NEXT_PUBLIC_ELASTIC_APM_SERVICE_NAME || 'airo-app-builder-frontend',
          serverUrl: detectServerUrl(),
          serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
          environment,

          distributedTracingOrigins: [
            window.location.origin,
            'https://airo-builder.test-godaddy.com',
            'https://airo-builder.godaddy.com',
          ],

          ignoreTransactions: [/fullstory\.com/],

          breakdownMetrics: environment !== 'production',

          // When active, fully sample — the activation gate above already
          // limits how many users reach this point
          transactionSampleRate: 1.0,

          logLevel: environment === 'development' ? 'warn' : 'error',
        });

        if (apm) {
          window.__apmInstance = apm as any;
        }

        return apm;
      } catch (error) {
        logger.error('rum.provider.init.failure', {
          message: 'Elastic APM RUM initialization failed',
          environment,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    initRum().catch(() => {});
  }, []);

  return <>{children}</>;
}
