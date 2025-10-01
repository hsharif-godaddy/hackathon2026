/**
 * Gasket OTel Custom Setup - Full Transaction Names
 * Configures OpenTelemetry to show full HTTP paths in transaction names
 * Example: "GET /api/sites/[id]" instead of just "GET"
 */

import { register } from '@godaddy/gasket-otel';

/**
 * Check if OpenTelemetry should be enabled
 * Only register if OTEL_EXPORTER_OTLP_ENDPOINT is configured
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!otlpEndpoint) {
  console.log('[OTel] Skipping OpenTelemetry registration - OTEL_EXPORTER_OTLP_ENDPOINT not configured');
} else {
  console.log('[OTel] Registering OpenTelemetry with endpoint:', otlpEndpoint);
  
  register({
    // Service identification
    serviceName: process.env.OTEL_SERVICE_NAME || 'airo-app-builder',
    serviceVersion: process.env.npm_package_version || '1.0.0',
    
    // OTLP exporter endpoint (from AWS Secrets Manager)
    exporterOtlpEndpoint: otlpEndpoint,
    
    // Custom instrumentation options for full transaction names
    autoInstrumentationOptions: {
      // HTTP instrumentation - capture full paths in span names
      '@opentelemetry/instrumentation-http': {
        // Customize span attributes and name
        applyCustomAttributesOnSpan: (span, request) => {
          if (request && request.url) {
            const url = typeof request.url === 'string' ? request.url : request.url.pathname || '/';
            const method = request.method || 'GET';
            
            // Set http.target attribute
            span.setAttribute('http.target', url);
            
            // Update span name to include method and full path
            span.updateName(`${method} ${url}`);
          }
        },
        
        // Ignore Next.js internal requests
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          return url.includes('/_next/') || 
                 url.includes('/__nextjs_') || 
                 url.includes('/static/');
        }
      }
    }
  });
}

