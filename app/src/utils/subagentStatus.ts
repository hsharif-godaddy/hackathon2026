import type { ToolStatus } from '@/app/[market]/develop/components/types'

/**
 * A sub-agent dispatched via `runAgent` runs detached in the background. The
 * `runAgent` tool call itself completes (toolStatus → 'completed') the instant
 * the backend acks the dispatch with a jobId — long before the sub-agent has
 * actually finished its work. The true lifecycle is observable only through the
 * `subagentEvents` stream keyed by the runAgent tool call's id.
 *
 * The detached job emits a final `outputs` event (JSON detail) carrying its
 * summary/artifacts/visualOutputs/docPath when it settles. That event — or a
 * fallback `completed`/`error` event — is the terminal signal.
 */

export type SubAgentLifecycle = 'running' | 'success' | 'error' | 'aborted' | 'timeout'

export interface SubAgentVisualOutput {
  type: 'media' | 'page' | 'doc'
  label: string
  url?: string
  thumbnailUrl?: string
}

export interface SubAgentOutputs {
  status?: string
  summary?: string
  artifacts?: string[]
  visualOutputs?: SubAgentVisualOutput[]
  docPath?: string
}

export interface SubAgentEventLike {
  event: string
  detail: string
}

/**
 * Parse the final `outputs` event (if present) from a sub-agent's event stream.
 * Returns undefined when no `outputs` event has arrived or its detail is not
 * valid JSON.
 */
export function parseSubagentOutputs(events: ReadonlyArray<SubAgentEventLike>): SubAgentOutputs | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.event !== 'outputs') continue
    try {
      return JSON.parse(e.detail) as SubAgentOutputs
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Status of a job as reported by a persisted `awaitAgents` result (the backend
 * JobStatus union). This is the durable terminal signal that survives a page
 * reload, where the in-memory `subagentEvents` stream is gone.
 */
export type AwaitedJobStatus = 'queued' | 'running' | 'success' | 'error' | 'aborted' | 'timeout'

/**
 * Derive a sub-agent's lifecycle. Priority:
 *  1. the live event stream (terminal `outputs`/`completed`/`error` event),
 *  2. the persisted `awaitAgents` result for this job (survives reload, where
 *     `subagentEvents` is empty),
 *  3. the runAgent tool call's own status (only tells us the dispatch outcome).
 * A sub-agent stays 'running' until one of these reports a terminal state, even
 * once the dispatching tool call itself reports 'completed'.
 */
export function deriveSubAgentLifecycle(
  events: ReadonlyArray<SubAgentEventLike>,
  toolStatus: ToolStatus,
  awaitedStatus?: AwaitedJobStatus,
): SubAgentLifecycle {
  const outputs = parseSubagentOutputs(events)
  if (outputs) {
    if (outputs.status === 'success') return 'success'
    if (outputs.status === 'aborted') return 'aborted'
    if (outputs.status === 'timeout') return 'timeout'
    return 'error'
  }
  if (events.some((e) => e.event === 'error')) return 'error'
  if (events.some((e) => e.event === 'completed')) return 'success'
  // No live terminal event: fall back to the persisted awaitAgents result.
  if (awaitedStatus) {
    if (awaitedStatus === 'success') return 'success'
    if (awaitedStatus === 'aborted') return 'aborted'
    if (awaitedStatus === 'timeout') return 'timeout'
    if (awaitedStatus === 'queued' || awaitedStatus === 'running') return 'running'
    return 'error'
  }
  // No terminal signal anywhere yet: only a failed dispatch counts as terminal.
  if (toolStatus === 'error') return 'error'
  return 'running'
}
