import { registerOTel } from '@vercel/otel';

/**
 * NextJS specific OTel registration with @vercel/otel
 * https://nextjs.org/docs/14/app/building-your-application/optimizing/open-telemetry
 */
export function register() {
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'airo-app-builder' });
}
