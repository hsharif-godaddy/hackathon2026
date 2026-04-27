/**
 * Retry Detection Module (Phase 6)
 *
 * NOTE: This module is scaffolding for a follow-up PR. The functions are
 * implemented and tested but not yet wired into the attribution flow.
 * Integration will be added in a subsequent PR that tracks execution
 * history across messages within a conversation.
 *
 * Detects when a user is retrying work that previously failed.
 * If the user's message references something that failed in the
 * immediately previous execution, the retry should be free (GoDaddy pays).
 *
 * Design principles:
 * - Zero latency: Simple string matching, no embeddings
 * - Immediate previous only: Tracks only the last execution (not full history)
 * - Conservative matching: Word boundaries to avoid false positives
 * - Memory efficient: Limited targets per execution, cleaned on disconnect
 */

import { createLogger } from '@airo/ai-common'
import {
  RETRY_DETECTION_CONFIG,
  type ExecutionHistory,
  type RetryDetectionResult,
} from './types.js'
import { messageReferencesTarget } from './failure-extraction.js'

const logger = createLogger('retry-detection')

// EXECUTION HISTORY MANAGEMENT

/**
 * Create execution history entry from execution data.
 * Limits targets to prevent memory bloat.
 *
 * @param hadFailures - Whether the execution had failures
 * @param failedTargets - Array of failed targets
 * @returns ExecutionHistory entry
 */
export function createExecutionHistory(
  hadFailures: boolean,
  failedTargets: string[]
): ExecutionHistory {
  // Limit targets and filter short ones that cause false positives
  const filteredTargets = failedTargets
    .filter(t => t.length >= RETRY_DETECTION_CONFIG.MIN_TARGET_LENGTH)
    .slice(0, RETRY_DETECTION_CONFIG.MAX_TARGETS_PER_EXECUTION)

  return {
    hadFailures,
    failedTargets: filteredTargets,
    timestamp: Date.now(),
  }
}

// RETRY DETECTION

/**
 * Check if a user message is a retry of previously failed work.
 *
 * A retry is detected when:
 * 1. The previous execution had failures
 * 2. The current message references a target that failed
 *
 * @param message - User's current message
 * @param history - Execution history from previous execution (or undefined)
 * @returns RetryDetectionResult with detection outcome
 */
export function detectRetry(
  message: string,
  history: ExecutionHistory | undefined
): RetryDetectionResult {
  // No history = no retry detection possible
  if (!history) {
    return {
      isRetry: false,
      previousFailedTargets: [],
      hadPreviousFailures: false,
    }
  }

  // Previous execution had no failures = can't be a retry
  if (!history.hadFailures || history.failedTargets.length === 0) {
    return {
      isRetry: false,
      previousFailedTargets: history.failedTargets,
      hadPreviousFailures: history.hadFailures,
    }
  }

  // Check if message references any failed target
  for (const target of history.failedTargets) {
    if (messageReferencesTarget(message, target)) {
      logger.debug('retry_detection.matched', {
        matchedTarget: target,
        messagePreview: message.slice(0, 100),
      })

      return {
        isRetry: true,
        matchedTarget: target,
        previousFailedTargets: history.failedTargets,
        hadPreviousFailures: true,
      }
    }
  }

  // Message doesn't reference any failed targets
  return {
    isRetry: false,
    previousFailedTargets: history.failedTargets,
    hadPreviousFailures: true,
  }
}

// LOGGING HELPERS

/**
 * Log retry detection evaluation for monitoring.
 */
export function logRetryDetectionEvaluated(
  result: RetryDetectionResult,
  context: {
    budgetId?: string
    sessionId?: string
    conversationId?: string
    socketId: string
  }
): void {
  logger.info('retry_detection.evaluated', {
    socketId: context.socketId,
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    isRetry: result.isRetry,
    matchedTarget: result.matchedTarget,
    hadPreviousFailures: result.hadPreviousFailures,
    previousTargetCount: result.previousFailedTargets.length,
  })
}

/**
 * Log when retry triggers free execution.
 */
export function logRetryOverride(
  result: RetryDetectionResult,
  totalCost: number,
  context: {
    budgetId: string
    sessionId: string
    conversationId?: string
  }
): void {
  logger.info('retry_detection.override', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    matchedTarget: result.matchedTarget,
    totalCost,
    reason: 'Retry of previously failed work',
  })
}
