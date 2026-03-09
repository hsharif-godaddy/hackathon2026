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
}
