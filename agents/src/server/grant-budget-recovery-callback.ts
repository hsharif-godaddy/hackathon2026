import { grantSessionManager } from '@airo/ai-grants'
import { hasNonIdempotentTools } from '@airo/ai-transport'
import type { BudgetRecoveryCallback, BudgetRecoveryResult } from '@airo/ai-transport'

interface CreateCallbackOptions {
  logger: {
    info: (event: string, fields: Record<string, unknown>) => void
    warn: (event: string, fields: Record<string, unknown>) => void
    error: (event: string, fields: Record<string, unknown>) => void
  }
}

/** Creates the budget recovery callback shared by WS and SSE transports.
 *  Attempts grant advancement, then frontend refresh via grantSessionManager. */
export function createGrantBudgetRecoveryCallback(opts: CreateCallbackOptions): BudgetRecoveryCallback {
  return async (sessionId: string, _error: Error, executedToolNames: string[]): Promise<BudgetRecoveryResult> => {
    const hasNonIdempotent = hasNonIdempotentTools(executedToolNames)

    try {
      const advanced = grantSessionManager.advanceToNextGrant(sessionId)
      if (advanced) {
        const newUserId = grantSessionManager.getCurrentUserId(sessionId)
        if (newUserId) {
          opts.logger.info('grants.mid_stream.advanced', {
            sessionId,
            newUserId,
            hasNonIdempotentTools: hasNonIdempotent,
            executedToolNames,
          })
          return { retry: true, newUserId, hasNonIdempotentTools: hasNonIdempotent }
        }
        opts.logger.warn('grants.mid_stream.advanced_but_no_userid', { sessionId })
      }

      const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(sessionId, 5000)
      if (gotNewGrants) {
        const newUserId = grantSessionManager.getCurrentUserId(sessionId)
        if (newUserId) {
          opts.logger.info('grants.mid_stream.refresh_advanced', {
            sessionId,
            newUserId,
            hasNonIdempotentTools: hasNonIdempotent,
            executedToolNames,
          })
          return { retry: true, newUserId, hasNonIdempotentTools: hasNonIdempotent }
        }
        opts.logger.warn('grants.mid_stream.refresh_but_no_userid', { sessionId })
      }

      opts.logger.warn('grants.mid_stream.all_exhausted', { sessionId, executedToolNames })
      return { retry: false, hasNonIdempotentTools: hasNonIdempotent }
    } catch (err) {
      opts.logger.error('grants.mid_stream.callback_internal_error', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      return { retry: false, hasNonIdempotentTools: hasNonIdempotent }
    }
  }
}
