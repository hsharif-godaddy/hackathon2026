import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Service name must match Elastic APM service name for correlation
const serviceName = 'airo-agents';
const serviceEnvironment = process.env.NODE_ENV || 'development';

// Create resource with service attributes for proper identification in Elastic APM
// Using standard OpenTelemetry resource semantic conventions
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  'service.version': process.env.npm_package_version || '0.1.0',
  // Elastic APM expects 'deployment.environment' for the environment filter
  'deployment.environment': serviceEnvironment,
  // Also set service.environment for compatibility
  'service.environment': serviceEnvironment
});

// Configure span processors for dual export: Langfuse + Elastic APM
const spanProcessors: SpanProcessor[] = [
  // Langfuse processor for AI-specific observability
  new LangfuseSpanProcessor()
];

// Add OTLP exporter for Elastic APM if configured
// Uses APM Server's OTLP intake endpoint (typically :8200/v1/traces)
const apmServerUrl = process.env.ELASTIC_APM_SERVER_URL;
const apmSecretToken = process.env.ELASTIC_APM_SECRET_TOKEN;

if (apmServerUrl && apmSecretToken) {
  // Construct OTLP endpoint from APM server URL using URL API for safety
  // APM Server exposes OTLP at the same port, just different path
  const otlpUrl = new URL(apmServerUrl);
  otlpUrl.pathname = '/v1/traces';
  otlpUrl.search = '';
  otlpUrl.hash = '';
  const otlpEndpoint = otlpUrl.toString();

  const elasticExporter = new OTLPTraceExporter({
    url: otlpEndpoint,
    headers: {
      // Use Bearer token authentication (same as APM secret token)
      'Authorization': `Bearer ${apmSecretToken}`
    }
  });

  // Use BatchSpanProcessor for better performance
  spanProcessors.push(new BatchSpanProcessor(elasticExporter));

  // Log that Elastic APM OTLP export is enabled
  // Note: Can't use Logger here as it may not be initialized yet
  console.log('[instrumentation] Elastic APM OTLP export enabled:', {
    serviceName,
    serviceEnvironment,
    endpoint: otlpEndpoint
  });
}

const sdk = new NodeSDK({
  resource,
  spanProcessors
});

sdk.start();
