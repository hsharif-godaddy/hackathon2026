'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/request-context';

/**
 * Elastic APM Real User Monitoring (RUM) Provider
 * 
 * Initializes the Elastic APM RUM agent for client-side monitoring.
 * This component should be mounted once at the root of the application
 * to enable performance monitoring, error tracking, and user interaction tracking.
 * 
 * The RUM server URL is automatically selected based on the hostname:
 * - Production (airo-builder.godaddy.com): uses production APM endpoint (144)
 * - Non-production (test/local): uses test APM endpoint (05)
 * 
 * Configuration can be overridden via environment variables:
 * - NEXT_PUBLIC_ELASTIC_APM_SERVER_URL: APM server endpoint (optional, auto-detected)
 * - NEXT_PUBLIC_ELASTIC_APM_SERVICE_NAME: Service identifier (default: 'airo-app-builder-frontend')
 * - NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT: Environment name (default: NODE_ENV)
 * 
 * @param children - React components to render
 * @returns React node with RUM initialized
 * 
 * @example
 * ```tsx
 * <RumProvider>
 *   <App />
 * </RumProvider>
 * ```
 */
export default function RumProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const isProduction = typeof window !== 'undefined' && window.location.hostname === 'airo-builder.godaddy.com';
    
    const serverUrl = process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL || 
      (isProduction 
        ? 'https://144cf045186b41c4a2a4aa3df8f92131.apm.us-west-2.aws.cloud.es.io:443'
        : 'https://0556df897be249269f7818244b522474.apm.us-west-2.aws.cloud.es.io:443'
      );
    
  
    const serviceName = process.env.NEXT_PUBLIC_ELASTIC_APM_SERVICE_NAME || 'airo-app-builder-frontend';
    const environment = (isProduction ? 'production' : 'development');

    const initRum = async () => {
      try {
        const { init: initApm } = await import('@elastic/apm-rum');
        
        const apm = initApm({
          serviceName,
          serverUrl,
          serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
          environment,
          
          distributedTracingOrigins: [
            typeof window !== 'undefined' ? window.location.origin : '',
            'https://airo-builder.test-godaddy.com',
            'https://airo-builder.godaddy.com',
          ],
          
          breakdownMetrics: true,
          
          transactionSampleRate: environment === 'production' ? 0.5 : 1.0,
          
          logLevel: environment === 'development' ? 'debug' : 'warn',
        });

      // Store APM instance globally for access by custom hooks
      if (typeof window !== 'undefined' && apm) {
        window.__apmInstance = apm as any;
        logger.info('rum.provider.init.success', {
          message: 'APM instance stored globally',
          is_active: apm.isActive(),
          has_start_transaction: typeof apm.startTransaction === 'function',
          has_get_current_transaction: typeof apm.getCurrentTransaction === 'function'
        });
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

