/**
 * OpenTelemetry instrumentation for Next.js
 *
 * This file is automatically loaded by Next.js when instrumentationHook is enabled.
 * It registers OpenTelemetry instrumentation for Next.js-specific operations
 * with full HTTP path capture in span names.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { registerOTel } from '@vercel/otel';

/**
 * Register OpenTelemetry instrumentation
 *
 * This function is called by Next.js during application initialization.
 * Configures OpenTelemetry to:
 * - Instrument Next.js HTTP operations
 * - Capture full paths in span names (e.g., "GET /api/sites/[id]")
 * - Export traces to configured OTLP endpoint
 */
export function register() {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!otlpEndpoint) {
    console.log('[OTel] Skipping Next.js instrumentation - OTEL_EXPORTER_OTLP_ENDPOINT not configured');
    return;
  }

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || 'airo-app-builder'
  });
}

