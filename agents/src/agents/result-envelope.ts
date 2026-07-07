import { z } from 'zod'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'result-envelope' })

/**
 * The result envelope. One validated, compact result that every delegated
 * sub-agent run returns to the orchestrator: the run's final output
 * (`summary`), files it wrote (`artifacts`), token `usage`, wall-clock
 * `durationMs`, and (on failure) `error`.
 *
 * The envelope is deliberately additive over the earlier `{status, summary,
 * artifacts, error}` shape so existing consumers (the orchestrator prompt, the
 * durable workflow-transitions substrate, the UI) keep reading the same fields.
 */

/**
 * Token/step usage for one delegated run. Mirrors the fields the runner already
 * emits on its `usage` SSE event (see `sub-agent-runner.ts`). Cost is
 * intentionally NOT carried here — it is derivable from `modelName` + tokens by
 * a separate per-run metrics path, which owns cost weighting.
 */
export const usageSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteInputTokens: z.number(),
  steps: z.number(),
})

export type SubAgentUsage = z.infer<typeof usageSchema>

/**
 * Terminal and in-flight statuses an envelope can carry. `timeout` lets a hung
 * worker surface as a timed-out envelope rather than blocking forever.
 */
export const RESULT_ENVELOPE_STATUSES = [
  'queued',
  'running',
  'success',
  'error',
  'aborted',
  'timeout',
] as const

export type ResultEnvelopeStatus = typeof RESULT_ENVELOPE_STATUSES[number]

/**
 * The validated envelope. Soft fields use `.catch(...)` so a single malformed
 * field degrades to its default instead of failing the whole parse; the four
 * identity fields (`jobId`/`agent`/`title`/`status`) are the only hard
 * requirements, and {@link buildResultEnvelope} degrades even those rather than
 * throwing.
 */
export const resultEnvelopeSchema = z.object({
  jobId: z.string(),
  agent: z.string(),
  title: z.string(),
  status: z.enum(RESULT_ENVELOPE_STATUSES),
  summary: z.string().optional().catch(undefined),
  artifacts: z.array(z.string()).optional().catch(undefined),
  usage: usageSchema.optional().catch(undefined),
  durationMs: z.number().nonnegative().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
})

export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>

/** Raw, pre-validation shape passed to {@link buildResultEnvelope}. */
export interface ResultEnvelopeInput {
  jobId: string
  agent: string
  title: string
  status: ResultEnvelopeStatus
  summary?: string
  artifacts?: string[]
  usage?: SubAgentUsage
  durationMs?: number
  error?: string
}

/**
 * Validate and normalize a raw result into a {@link ResultEnvelope}. Degrades on
 * malformed input instead of throwing: if the identity fields can't be parsed it
 * returns a best-effort `error` envelope that records the validation failure in
 * `error`, so a bad worker result never crashes the orchestrator's await path.
 */
export function buildResultEnvelope(input: ResultEnvelopeInput): ResultEnvelope {
  const parsed: ReturnType<typeof resultEnvelopeSchema.safeParse> = resultEnvelopeSchema.safeParse(input)
  if (parsed.success) {
    return parsed.data
  }

  logger.warn('resultEnvelope.malformed', {
    jobId: typeof input?.jobId === 'string' ? input.jobId : 'unknown',
    agent: typeof input?.agent === 'string' ? input.agent : 'unknown',
    error: parsed.error.message,
  })

  const degraded: ResultEnvelope = {
    jobId: typeof input?.jobId === 'string' ? input.jobId : 'unknown',
    agent: typeof input?.agent === 'string' ? input.agent : 'unknown',
    title: typeof input?.title === 'string' ? input.title : '',
    status: 'error',
    error: `result envelope failed validation: ${parsed.error.message}`,
    ...(typeof input?.summary === 'string' && { summary: input.summary }),
  }
  return degraded
}
