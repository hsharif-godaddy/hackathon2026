import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node'

// CSP report-uri beacons fire on every customer page load and carry no APM
// value. Anchored to the URL host so it can't match csp.godaddy.com sitting
// inside a query string (e.g. ?callback=https://csp.godaddy.com).
const CSP_HOST_RE: RegExp = /^https?:\/\/csp\.(dev-|test-)?godaddy\.com(?:[/:?#]|$)/

// dev-supervisor traffic rides a Unix domain socket, so Node fills the Host
// header with "localhost" (no port) and the undici span name comes out as
// "<METHOD> localhost/<path>". High-volume infra calls that drown out real app
// behavior. Customer-app preview spans use "localhost:<port>/..." (with a port)
// and are intentionally NOT matched.
const DEV_SUPERVISOR_NAME_RE: RegExp = /^[A-Z]+ localhost\/([^/?#]+)/
const DEV_SUPERVISOR_PATHS: ReadonlySet<string> = new Set<string>([
  'workspace', 'tasks', 'process', 'setup', 'proxy',
  'publish', 'unpublish', 'exec', 'info', 'health', 'health-config',
])

export type SpanDropPredicate = (span: ReadableSpan) => boolean

// Vercel AI SDK experimental_telemetry spans duplicate the HTTP CLIENT spans we
// already capture for the underlying LLM calls and balloon Kibana with inline
// prompt/response text. Kept on the EventBus/Langfuse processors (separate
// branch); dropped only from OTLP.
export const isAiSpan: SpanDropPredicate = (span: ReadableSpan): boolean =>
  span.name.startsWith('ai.')

export const isCspSpan: SpanDropPredicate = (span: ReadableSpan): boolean => {
  const url: unknown = span.attributes['http.url'] ?? span.attributes['url.full']
  return typeof url === 'string' && CSP_HOST_RE.test(url)
}

export const isDevSupervisorSpan: SpanDropPredicate = (span: ReadableSpan): boolean => {
  const match: RegExpExecArray | null = DEV_SUPERVISOR_NAME_RE.exec(span.name)
  return match !== null && DEV_SUPERVISOR_PATHS.has(match[1]!)
}

/**
 * SpanProcessor decorator that drops any span matching one of `predicates`
 * before it reaches the wrapped exporter chain. Intentionally OTLP-only: the
 * EventBus and Langfuse processors sit on a sibling branch off the tracer
 * provider and keep receiving every span, including the ai.* / CSP /
 * dev-supervisor ones this filter removes from Elastic.
 */
export class OtlpSpanFilterProcessor implements SpanProcessor {
  constructor(
    private readonly delegate: SpanProcessor,
    private readonly predicates: readonly SpanDropPredicate[],
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    for (const drop of this.predicates) {
      if (drop(span)) return
    }
    this.delegate.onEnd(span)
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush()
  }
}
