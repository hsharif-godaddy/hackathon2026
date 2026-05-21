import { BudgetExceededError } from '@airo/ai-common'

export interface BudgetRecoveryResult {
  retry: boolean
  newUserId?: string
  hasNonIdempotentTools: boolean
}

/** Callback that attempts grant advancement after mid-stream budget exhaustion.
 *  Must not throw — internal errors should be caught and returned as { retry: false }. */
export type BudgetRecoveryCallback = (
  sessionId: string,
  error: Error,
  executedToolNames: string[],
) => Promise<BudgetRecoveryResult>

export const MAX_BUDGET_RETRIES = 3
const RECOVERY_CALLBACK_TIMEOUT_MS = 10_000

export class BudgetRecoveryTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`Budget recovery callback timed out after ${timeoutMs}ms`)
    this.name = 'BudgetRecoveryTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export interface BudgetRecoveryStreamOptions {
  sessionId: string
  onBudgetExhausted: BudgetRecoveryCallback
  setUserId: (newUserId: string) => void
  getExecutedToolNames: () => string[]
  getAccumulatedContent: () => string
  clearTurnState: () => void
  /** Emit stream_retry to client. Only called for Layer 2 (clean retry). */
  publishStreamRetry?: (agentName: string) => Promise<void>
  logger: {
    info: (event: string, fields: Record<string, unknown>) => void
    warn: (event: string, fields: Record<string, unknown>) => void
    error: (event: string, fields: Record<string, unknown>) => void
  }
}

export function buildContinuationPrompt(originalPrompt: string, executedToolNames: string[], partialContent: string): string {
  const parts: string[] = [
    `The user's original request: "${originalPrompt}"`,
  ]
  if (executedToolNames.length > 0) {
    parts.push(`The following tool calls already completed successfully: ${executedToolNames.join(', ')}. Do not re-execute them.`)
  }
  if (partialContent) {
    parts.push(`You were in the middle of responding. Your partial response so far: "${partialContent.slice(-500)}"`)
  }
  parts.push('Continue the task from where you left off.')
  return parts.join('\n\n')
}

/** Wraps a "stream one LLM turn" function with mid-stream budget recovery.
 *
 *  On BudgetExceededError:
 *  - Layer 2 (no non-idempotent tools): emit stream_retry, clear state, retry same prompt
 *  - Layer 3 (non-idempotent tools ran): clear events, build continuation prompt, retry
 *  - Max 3 retries; re-throws if recovery fails or cap exceeded */
export async function withBudgetRecovery<T>(
  streamFn: (prompt: string) => Promise<T>,
  originalPrompt: string,
  agentName: string,
  opts: BudgetRecoveryStreamOptions,
  retryCount: number = 0,
): Promise<T> {
  try {
    return await streamFn(originalPrompt)
  } catch (error) {
    if (!BudgetExceededError.isInstance(error) || retryCount >= MAX_BUDGET_RETRIES) {
      throw error
    }

    const executedToolNames = opts.getExecutedToolNames()

    opts.logger.info('budget.mid_stream.attempting_recovery', {
      sessionId: opts.sessionId,
      agentName,
      executedToolNames,
      retryCount,
    })

    const result = await invokeBudgetRecoveryCallback(
      opts.onBudgetExhausted,
      opts.sessionId,
      error as Error,
      executedToolNames,
      opts.logger,
    )

    if (!result) {
      throw error
    }

    if (!result.retry || !result.newUserId) {
      if (result.retry && !result.newUserId) {
        opts.logger.error('budget.mid_stream.retry_true_no_userid', {
          sessionId: opts.sessionId,
          agentName,
          reason: 'callback returned retry:true without newUserId — contract violation',
        })
      } else {
        opts.logger.warn('budget.mid_stream.recovery_failed', {
          sessionId: opts.sessionId,
          agentName,
          reason: 'grants_exhausted',
        })
      }
      throw error
    }

    opts.setUserId(result.newUserId)
    opts.logger.info('budget.mid_stream.recovery_granted', {
      sessionId: opts.sessionId,
      agentName,
      newUserId: result.newUserId,
      hasNonIdempotentTools: result.hasNonIdempotentTools,
    })

    if (!result.hasNonIdempotentTools) {
      // Layer 2: Clean retry with same prompt
      opts.clearTurnState()
      await opts.publishStreamRetry?.(agentName)
      return withBudgetRecovery(streamFn, originalPrompt, agentName, opts, retryCount + 1)
    }

    // Layer 3: Continuation with tool context preserved
    const partialContent = opts.getAccumulatedContent()
    const continuationPrompt = buildContinuationPrompt(originalPrompt, executedToolNames, partialContent)
    opts.clearTurnState()
    return withBudgetRecovery(streamFn, continuationPrompt, agentName, opts, retryCount + 1)
  }
}

/** Invoke a budget recovery callback with timeout.
 *  Returns the result or null on timeout/failure. */
export async function invokeBudgetRecoveryCallback(
  callback: BudgetRecoveryCallback,
  sessionId: string,
  error: Error,
  executedToolNames: string[],
  logger: BudgetRecoveryStreamOptions['logger'],
): Promise<BudgetRecoveryResult | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      callback(sessionId, error, executedToolNames),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new BudgetRecoveryTimeoutError(RECOVERY_CALLBACK_TIMEOUT_MS)),
          RECOVERY_CALLBACK_TIMEOUT_MS,
        )
      }),
    ])
    clearTimeout(timeoutHandle)
    return result
  } catch (callbackErr) {
    clearTimeout(timeoutHandle)
    if (callbackErr instanceof BudgetRecoveryTimeoutError) {
      logger.error('budget.mid_stream.callback_timeout', {
        sessionId,
        timeoutMs: callbackErr.timeoutMs,
      })
    } else {
      logger.error('budget.mid_stream.callback_error', {
        sessionId,
        error: callbackErr instanceof Error ? callbackErr.message : String(callbackErr),
      })
    }
    return null
  }
}

