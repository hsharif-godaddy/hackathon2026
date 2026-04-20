/**
 * NextJS instrumentation hook
 * https://nextjs.org/docs/14/app/building-your-application/optimizing/instrumentation
 *
 * Uses @vercel/otel for OpenTelemetry SDK initialization with Next.js-specific instrumentation.
 * Traces are exported to Elastic APM via OTLP using environment variables:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: Elastic APM OTLP endpoint
 * - OTEL_EXPORTER_OTLP_HEADERS: Authorization headers
 * - OTEL_SERVICE_NAME: Service name for traces
 */

import { registerOTel } from '@vercel/otel';

export async function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || 'airo-app-builder',
  });

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Pre-fetch JWT signing keys from Secrets Manager so the JWKS endpoint
    // responds instantly on first hit (avoids 15s cold-start in local dev).
    const { getJWTService } = await import('./lib/jwt-service');
    const { logger } = await import('./lib/request-context');
    getJWTService().warmKeys().catch((err) => {
      logger.error('jwt.warmup.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
