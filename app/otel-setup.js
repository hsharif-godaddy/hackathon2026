/**
 * Gasket OTel Setup for Proxy Server
 *
 * Configures OpenTelemetry for the Express proxy server layer only.
 * HTTP instrumentation is disabled to avoid duplicates with Next.js instrumentation
 * (Next.js instrumentation is handled by app/instrumentation.ts via @vercel/otel).
 *
 * This setup only instruments:
 * - Express middleware and routing
 * - DNS operations
 */

import { register } from '@godaddy/gasket-otel';

/**
 * Check if OpenTelemetry should be enabled
 * Only register if OTEL_EXPORTER_OTLP_ENDPOINT is configured
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!otlpEndpoint) {
  console.log('[OTel] Skipping Gasket OTel registration - OTEL_EXPORTER_OTLP_ENDPOINT not configured');
} else {
  console.log('[OTel] Registering Gasket OTel for proxy server');

  register({
    // Service identification
    serviceName: process.env.OTEL_SERVICE_NAME || 'airo-app-builder',
    serviceVersion: process.env.npm_package_version || '1.0.0',

    // OTLP exporter endpoint (from AWS Secrets Manager)
    exporterOtlpEndpoint: otlpEndpoint,

    // Disable HTTP instrumentation to avoid duplicates with Next.js
    // Only instrument Express and DNS operations
    /**
     * nodeEnabledInstrumentations determines which Node.js modules are instrumented.
     * Common options include: 'http', 'https', 'express', 'dns', 'fs', etc.
     * See the full list of available options at:
     * https://github.com/godaddy/gasket-otel#nodeenabledinstrumentations
     */
    nodeEnabledInstrumentations: 'express,dns',

    // Custom instrumentation options
    autoInstrumentationOptions: {
      // Express instrumentation for proxy server
      '@opentelemetry/instrumentation-express': {
        enabled: true
      }
    }
  });
}

