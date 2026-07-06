import stringify from 'safe-stable-stringify'
import { BackgroundTaskRegistry, type BackgroundTaskOutcome } from './background-task-registry.js'

export interface BackgroundTaskAwaitLogger {
  info: (event: string, fields: Record<string, unknown>) => void
  warn: (event: string, fields: Record<string, unknown>) => void
}

export interface BackgroundTaskAwaitParams {
  registry: BackgroundTaskRegistry
  toolCalls: Array<{ toolName: string }>
  stopAfterTools: readonly string[] | undefined
  abortSignal: AbortSignal
  logger: BackgroundTaskAwaitLogger
  logContext?: Record<string, unknown>
}

export interface BackgroundTaskAwaitResult {
  continuationPrompt: string
  outcomes: BackgroundTaskOutcome[]
}

export function formatBackgroundTaskOutcomes(outcomes: BackgroundTaskOutcome[]): string {
  const lines: string[] = ['[System: Background tasks settled]']
  for (const outcome of outcomes) {
    if (outcome.status === 'completed') {
      const detail: string = outcome.result ? (stringify(outcome.result) ?? '[unserializable]') : ''
      lines.push(`- ${outcome.toolName} (${outcome.taskId}): completed.${detail ? ` Result: ${detail}` : ''}`)
    } else if (outcome.status === 'failed') {
      lines.push(`- ${outcome.toolName} (${outcome.taskId}): FAILED. Error: ${outcome.error ?? 'unknown'}`)
    } else {
      lines.push(`- ${outcome.toolName} (${outcome.taskId}): TIMED OUT. ${outcome.error ?? ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * Drains settled background tasks and optionally blocks for pending ones.
 * Returns a continuation prompt when outcomes are available, or null when
 * there is nothing to report (registry empty, flag off, stop-after tool,
 * or abort).
 *
 * Stop-after tool behavior: outcomes already settled are logged for
 * observability but NOT surfaced as a continuation (stop-after wins —
 * the turn terminates for user interaction). Pending tasks remain in the
 * registry for the next turn.
 *
 * Caller must NOT accumulate results across iterations — each call is
 * self-contained (drain + await + format). This prevents runaway
 * auto-continuation from stale outcomes.
 *
 * Never throws — errors are logged and the function returns null.
 */
export async function runBackgroundTaskAwait(
  params: BackgroundTaskAwaitParams,
): Promise<BackgroundTaskAwaitResult | null> {
  const { registry, toolCalls, stopAfterTools, abortSignal, logger, logContext } = params

  try {
    // Phase 1: Non-blocking drain of already-settled tasks
    const outcomes: BackgroundTaskOutcome[] = registry.drain()

    // Stop-after tool: log settled outcomes for observability but do NOT
    // return a continuation — stop-after means "pause for user interaction"
    // and must not be overridden by auto-continue.
    const hitStopAfter: boolean = isStopAfterTool(toolCalls, stopAfterTools)
    if (hitStopAfter) {
      if (outcomes.length > 0) {
        logger.info('sse.background_tasks.stop_after_dropped', {
          ...(logContext ?? {}),
          taskCount: outcomes.length,
          statuses: outcomes.map((o: BackgroundTaskOutcome) => o.status),
        })
      }
      return null
    }

    // Phase 2: Blocking await for pending tasks
    if (registry.hasPending()) {
      while (registry.hasPending()) {
        if (abortSignal.aborted) break
        const settled: BackgroundTaskOutcome[] = await registry.awaitNext()
        if (settled.length === 0) break
        outcomes.push(...settled)
      }
      outcomes.push(...registry.drain())
    }

    if (outcomes.length === 0) return null

    logger.info('sse.background_tasks.awaited', {
      ...(logContext ?? {}),
      taskCount: outcomes.length,
      statuses: outcomes.map((o: BackgroundTaskOutcome) => o.status),
    })

    return { continuationPrompt: formatBackgroundTaskOutcomes(outcomes), outcomes }
  } catch (err: unknown) {
    logger.warn('sse.background_tasks.runner_error', {
      ...(logContext ?? {}),
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function isStopAfterTool(
  toolCalls: Array<{ toolName: string }>,
  stopAfterTools: readonly string[] | undefined,
): boolean {
  if (!stopAfterTools || stopAfterTools.length === 0 || toolCalls.length === 0) return false
  const lastTool: { toolName: string } | undefined = toolCalls[toolCalls.length - 1]
  return lastTool !== undefined && stopAfterTools.includes(lastTool.toolName)
}

