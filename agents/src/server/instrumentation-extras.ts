import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { defaultResource, resourceFromAttributes, type Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { GDEnvEnum } from '@godaddy/agent-observability-events'
import { createAgentSpanProcessor } from '@godaddy/agent-otel-sdk'
import {
  AGENT_SERVICE_ID,
  AGENT_SERVICE_NAME,
  MULTI_AGENT_SYSTEM,
} from '@airo/ai-transport'

import { logger, toPinoLogger } from '../logging/index.js'
import { resolveEnv } from '../utils/gd-env.js'
import { installDedupingDiagLogger } from './diag-logger.js'
import { OtlpSpanFilterProcessor, isAiSpan, isCspSpan, isDevSupervisorSpan } from './otlp-span-filter.js'
import { scrubHeadersForLog } from './scrub-headers.js'

// Owns the TracerProvider and every span processor. Imported from app.ts right
// after the instrumentation.ts preload and before the server listens — splitting
// it out keeps the express-pulling deps below (pino logger, @godaddy/* SDKs,
// @airo/ai-transport) out of the preload, which must patch http/express first.

const gdEnvMap = { dev: GDEnvEnum.Dev, test: GDEnvEnum.Test, prod: GDEnvEnum.Prod } as const

// Replace the preload's console diag logger with the pino-backed one now that
// the structured logger is importable; same deduping behavior.
installDedupingDiagLogger((level, event) => logger[level]('otel.diag', event), true)

const observabilityEnabled: boolean = process.env.ENABLE_OBSERVABILITY_EVENTS === 'true'
const langfuseConfigured: boolean = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
const otlpConfigured: boolean = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT

// Assigned when a provider is registered (deferred: registration is gated on a
// backend being configured), so shutdown() can flush buffered spans before exit.
let registeredProvider: NodeTracerProvider | null = null

if (observabilityEnabled || langfuseConfigured || otlpConfigured) {
  const resource: Resource = defaultResource().merge(resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'airo-agents',
    [ATTR_SERVICE_VERSION]: process.env.AGENT_IMAGE_TAG || 'unknown',
    'deployment.environment': resolveEnv(),
    'container.image.tag': process.env.AGENT_IMAGE_TAG || 'unknown',
    'appId': process.env.SITE_ID || 'default-site',
  }))

  const spanProcessors: SpanProcessor[] = []

  if (langfuseConfigured) {
    const { LangfuseSpanProcessor } = await import('@langfuse/otel')
    spanProcessors.push(new LangfuseSpanProcessor())
  }

  if (otlpConfigured) {
    // ai.* / CSP / dev-supervisor spans are dropped from the OTLP (Elastic) path
    // only — EventBus and Langfuse below still receive them.
    spanProcessors.push(
      new OtlpSpanFilterProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter()),
        [isCspSpan, isAiSpan, isDevSupervisorSpan],
      ),
    )
    logger.info('instrumentation.otlp.enabled', { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
  }

  if (observabilityEnabled) {
    const apiKey: string | undefined = process.env.EVENTBUS_API_KEY
    if (!apiKey) {
      logger.warn('instrumentation.init.missing_api_key', {
        message: 'EVENTBUS_API_KEY is not set; disabling observability span processor',
      })
    } else {
      spanProcessors.push(createAgentSpanProcessor({
        clientOptions: {
          eventBusOptions: { dxEnabled: false, apiKey, env: gdEnvMap[resolveEnv()] },
          globalContext: {
            site: { privateLabelId: 1 },
            context: { userType: 'c1' },
            agent: {
              agentId: AGENT_SERVICE_ID,
              agentName: AGENT_SERVICE_NAME,
              multiAgentSystem: MULTI_AGENT_SYSTEM,
            },
          },
        },
        // Override default 10 min TTL to 30 min for slow AAB agent responses
        trackedSpanTtlMs: Number(process.env.TRACKED_SPAN_TTL_MS ?? 1_800_000),
        logger: toPinoLogger(logger),
      }))
    }
  }

  const tracerProvider: NodeTracerProvider = new NodeTracerProvider({ resource, spanProcessors })
  tracerProvider.register()
  registeredProvider = tracerProvider

  if (otlpConfigured) {
    void probeOtlpEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT!, process.env.OTEL_EXPORTER_OTLP_HEADERS)
  }
}

/**
 * Flush buffered spans before process exit. The BatchSpanProcessor holds spans
 * for up to its schedule delay, so without this a SIGTERM/deploy drops the final
 * batch (including error spans right before shutdown) — elastic-apm-node flushed
 * on exit, so this restores parity. Best-effort and timeout-guarded so it can
 * never hang or fail the shutdown path.
 */
export async function flushTelemetry(timeoutMs: number = 3000): Promise<void> {
  if (!registeredProvider) return
  try {
    await Promise.race([
      registeredProvider.forceFlush(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  } catch {
    // best-effort — never block or fail shutdown on a flush error
  }
}

async function probeOtlpEndpoint(endpoint: string, rawHeaders: string | undefined): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-protobuf' }
  for (const pair of (rawHeaders ?? '').split(',')) {
    const eq: number = pair.indexOf('=')
    if (eq !== -1) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  try {
    const res: Response = await context.with(suppressTracing(context.active()), () =>
      fetch(`${endpoint}/v1/traces`, {
        method: 'POST',
        headers,
        body: new Uint8Array(0),
        signal: AbortSignal.timeout(5000),
      }),
    )
    if (res.status === 401 || res.status === 403) {
      logger.warn('instrumentation.otlp.auth_failed', { status: res.status, endpoint })
    } else {
      logger.info('instrumentation.otlp.reachable', { status: res.status, endpoint })
    }
  } catch (err) {
    logger.warn('instrumentation.otlp.unreachable', {
      endpoint,
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : undefined,
      errorCause: err instanceof Error && err.cause ? String(err.cause) : undefined,
      headers: scrubHeadersForLog(headers),
      otelServiceName: process.env.OTEL_SERVICE_NAME,
    })
  }
}
