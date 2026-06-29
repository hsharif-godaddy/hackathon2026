import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { registerInstrumentations } from '@opentelemetry/instrumentation'

import { installDedupingDiagLogger } from './diag-logger.js'

// Preloaded via `node --import` so the HTTP/Express/Undici instrumentations
// patch their target modules BEFORE app code imports express. This module must
// stay import-safe: only @opentelemetry/* plus the express-free diag helper.
// Pulling in the pino logger, the @godaddy/* SDKs, or @airo/ai-transport here
// would load express first and silently disable Express instrumentation.
//
// The TracerProvider and every span processor live in instrumentation-extras.ts,
// which app.ts imports immediately after this and before the server listens. The
// API's ProxyTracer bridges the two: once the provider registers, tracers
// obtained earlier delegate to it. Spans created in the gap before it registers
// are non-recording and lost — acceptable because no HTTP/AI span is created
// during the module-load window (the server isn't listening and prewarm runs later).

installDedupingDiagLogger((level, event) =>
  console[level === 'debug' ? 'log' : level](JSON.stringify({ event: 'otel.diag', level, ...event })),
)

const INTERNAL_HOSTS: Set<string> = new Set(['localhost', '127.0.0.1', '::1'])

const anyBackendConfigured: boolean =
  process.env.ENABLE_OBSERVABILITY_EVENTS === 'true' ||
  !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) ||
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT

if (anyBackendConfigured) {
  registerInstrumentations({
    // Transports covered: HTTP/1.x via node:http+https (HttpInstrumentation),
    // native fetch via undici (UndiciInstrumentation), Express routing
    // (ExpressInstrumentation). NOT covered: node:http2 (no maintained
    // standalone OTel package) and @grpc/grpc-js (add
    // @opentelemetry/instrumentation-grpc if real gRPC traffic ever lands).
    instrumentations: [
      new HttpInstrumentation({
        applyCustomAttributesOnSpan: (span, request, response) => {
          const isServer: boolean = 'setHeader' in response
          const method: string = (request as { method?: string }).method ?? 'HTTP'
          if (isServer) {
            const routePath: string | undefined = (request as { route?: { path?: string } }).route?.path
            if (routePath) {
              span.updateName(`${method} ${routePath}`)
            } else {
              const status: number | string = (response as { statusCode?: number }).statusCode ?? 'unknown'
              span.updateName(`${method} (unrouted ${status})`)
            }
          } else {
            const req: { host?: string; path?: string } = request as { host?: string; path?: string }
            const host: string = req.host ?? 'unknown'
            const path: string = req.path ?? '/'
            span.updateName(`${method} ${host}${path}`)
          }
        },
      }),
      new ExpressInstrumentation(),
      new UndiciInstrumentation({
        requestHook: (span, request) => {
          let hostname: string = 'unknown'
          let pathname: string = request.path ?? '/'
          try {
            const url: URL = new URL(request.origin + request.path)
            hostname = url.hostname
            pathname = url.pathname
            span.setAttribute('http_is_external', !INTERNAL_HOSTS.has(hostname.toLowerCase()))
            span.setAttribute('destination_service_resource', `${hostname}${pathname}`)
          } catch {
            // Parse failed — still produce a useful span name below.
          }
          span.updateName(`${request.method} ${hostname}${pathname}`)
        },
      }),
    ],
  })
}
