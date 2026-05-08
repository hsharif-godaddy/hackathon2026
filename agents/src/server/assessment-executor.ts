/**
 * Assessment Executor
 *
 * Handles assessment agent execution in both parallel (budget service) and
 * blocking (grants) modes. Extracted from ai-lib-websocket-server.ts for
 * cleaner separation of concerns and easier testing.
 */

import { getAssessmentAgent, type AssessmentOutcome, type ClassifierMode, AssessmentTaskType } from '../agents/assessment-agent/index.js'
import { logger } from '../logging/index.js'

/** Assessment execution mode constants */
export const ASSESSMENT_MODE = {
  PARALLEL: 'parallel',
  BLOCKING: 'blocking',
} as const

/** Timeout for parallel assessment awaiting in beforeMessageComplete and onMessageComplete */
export const PARALLEL_ASSESSMENT_TIMEOUT_MS = 5000

/**
 * State for tracking parallel assessment execution.
 * Combines promise and eagerly-cached outcome in a single structure.
 */
export interface ParallelAssessmentState {
  promise: Promise<AssessmentOutcome>
  outcome?: AssessmentOutcome
  timedOut?: boolean
  /** Timestamp for TTL-based pruning of leaked entries */
  createdAt: number
}

/**
 * Derives whether free grants were used for billing purposes.
 * Only applies in grants mode (budgetServiceEnabled=false).
 * In BMS mode, cost attribution happens via onBudgetReport, not free grants.
 */
export function deriveUsedFreeGrants(
  budgetServiceEnabled: boolean,
  outcome: AssessmentOutcome | undefined,
  enableAssessmentOverride: boolean
): boolean {
  return !budgetServiceEnabled && outcome?.overrideApplied === true && enableAssessmentOverride
}

/** Reason codes for shouldAwaitParallelAssessment decision */
export const AWAIT_ASSESSMENT_REASON = {
  HAS_OUTCOME: 'has_outcome',
  ALREADY_TIMED_OUT: 'already_timed_out',
  SHOULD_AWAIT: 'should_await',
} as const

export type AwaitAssessmentReason = typeof AWAIT_ASSESSMENT_REASON[keyof typeof AWAIT_ASSESSMENT_REASON]

/**
 * Determines whether onMessageComplete should await the parallel assessment promise.
 * Returns false if:
 * - Outcome is already cached (eager .then() populated it)
 * - Already timed out in beforeMessageComplete (prevents double-await)
 *
 * This guard prevents onMessageComplete from arming a second timeout timer
 * after beforeMessageComplete already timed out or caught a rejection.
 */
export function shouldAwaitParallelAssessment(
  parallelState: ParallelAssessmentState
): { shouldAwait: boolean; reason: AwaitAssessmentReason } {
  if (parallelState.outcome) {
    return { shouldAwait: false, reason: AWAIT_ASSESSMENT_REASON.HAS_OUTCOME }
  }
  if (parallelState.timedOut) {
    return { shouldAwait: false, reason: AWAIT_ASSESSMENT_REASON.ALREADY_TIMED_OUT }
  }
  return { shouldAwait: true, reason: AWAIT_ASSESSMENT_REASON.SHOULD_AWAIT }
}

/**
 * Cleans up assessment state on error based on execution mode.
 * - Grants mode (budgetServiceEnabled=false): deletes blockingAssessmentOutcomes
 * - BMS mode (budgetServiceEnabled=true): preserves parallelAssessmentStates for onBudgetReport
 *
 * @returns Whether parallel state was preserved (for logging)
 */
export function cleanupAssessmentStateOnError(
  budgetServiceEnabled: boolean,
  parallelStates: Map<string, ParallelAssessmentState>,
  blockingOutcomes: Map<string, AssessmentOutcome>,
  socketId: string
): { preserved: boolean } {
  if (!budgetServiceEnabled) {
    blockingOutcomes.delete(socketId)
    return { preserved: false }
  }
  return { preserved: parallelStates.has(socketId) }
}

/**
 * Context required to execute assessment classification
 */
export interface AssessmentExecutorContext {
  socketId: string
  message: string
  appId: string
  customerId?: string
  budgetServiceEnabled: boolean
  enableAssessmentOverride: boolean
  isInitialPrompt: boolean
  previousUserMessage?: string
  previousAssessmentTaskType?: AssessmentTaskType
  classifierMode?: ClassifierMode
}

/**
 * Result from parallel mode execution (budget service enabled)
 * Returns immediately with a promise - does not block execution
 */
export interface ParallelAssessmentResult {
  mode: typeof ASSESSMENT_MODE.PARALLEL
  /** Promise that resolves to assessment outcome - await post-execution */
  assessmentPromise: Promise<AssessmentOutcome>
  /** Message to cache for multi-turn context */
  messageToCache: string
}

/**
 * Result from blocking mode execution (grants mode)
 * Returns after assessment completes
 */
export interface BlockingAssessmentResult {
  mode: typeof ASSESSMENT_MODE.BLOCKING
  /** Completed assessment outcome */
  assessmentOutcome: AssessmentOutcome
  /** Message to cache for multi-turn context */
  messageToCache: string
  /** Budget override to apply in contextProvider (if override applied and enabled) */
  pendingBudgetOverride?: string
}

export type AssessmentExecutorResult = ParallelAssessmentResult | BlockingAssessmentResult

/**
 * Execute assessment agent classification
 *
 * Behavior depends on budgetServiceEnabled:
 * - true (parallel mode): Starts assessment non-blocking, returns promise immediately
 * - false (blocking mode): Awaits assessment, returns completed result with overrides
 *
 * @param ctx - Assessment execution context
 * @returns Result with mode-specific data for caller to store/use
 */
export async function executeAssessment(
  ctx: AssessmentExecutorContext
): Promise<AssessmentExecutorResult> {
  const assessmentAgent = getAssessmentAgent()

  const classifyOptions = {
    appId: ctx.appId,
    customerId: ctx.customerId,
    socketId: ctx.socketId,
    enabledOverride: true, // Always true when executeAssessment is called
    previousUserMessage: ctx.previousUserMessage,
    previousAssessmentTaskType: ctx.previousAssessmentTaskType,
    isInitialPrompt: ctx.isInitialPrompt,
    classifierMode: ctx.classifierMode,
  }

  if (ctx.budgetServiceEnabled) {
    // PARALLEL MODE (Budget Service): Start assessment non-blocking
    // Cost attribution happens post-execution, no need to pre-set GoCode userId
    logger.info('assessment.execution_mode.parallel', {
      appId: ctx.appId,
      customerId: ctx.customerId,
      socketId: ctx.socketId,
      isInitialPrompt: ctx.isInitialPrompt,
      hasPreviousContext: !!ctx.previousUserMessage,
    })

    const assessmentPromise = assessmentAgent.classify(ctx.message, classifyOptions)

    // Attach catch to prevent unhandled rejection between promise creation
    // and when the eager .then() handler or withTimeout attaches its handler.
    // This is a safety net for fast rejections that occur before other handlers attach.
    // Primary error handling happens in the consumer's try/catch blocks via withTimeout.
    // Note: The eager .then() in onMessageStart also has its own catch with logging.
    assessmentPromise.catch(() => {
      // Intentionally no-op here - logging happens in the eager cache handler
      // in ai-lib-websocket-server.ts (assessment.parallel_mode.eager_cache_rejection)
    })

    return {
      mode: ASSESSMENT_MODE.PARALLEL,
      assessmentPromise,
      messageToCache: ctx.message,
    }
  } else {
    // BLOCKING MODE (Grants): Await assessment before execution proceeds
    // Must complete to override GoCode userId for pre-execution budget routing
    logger.info('assessment.execution_mode.blocking', {
      appId: ctx.appId,
      customerId: ctx.customerId,
      socketId: ctx.socketId,
      isInitialPrompt: ctx.isInitialPrompt,
      hasPreviousContext: !!ctx.previousUserMessage,
      enableAssessmentOverride: ctx.enableAssessmentOverride,
    })

    const assessmentOutcome = await assessmentAgent.classify(ctx.message, classifyOptions)

    const result: BlockingAssessmentResult = {
      mode: ASSESSMENT_MODE.BLOCKING,
      assessmentOutcome,
      messageToCache: ctx.message,
    }

    // Determine budget override if applicable
    // Only apply if both:
    // 1. Assessment determined override should apply (overrideApplied)
    // 2. Override feature flag is enabled (enableAssessmentOverride)
    if (assessmentOutcome.overrideApplied && assessmentOutcome.appliedBudget) {
      if (ctx.enableAssessmentOverride) {
        result.pendingBudgetOverride = assessmentOutcome.appliedBudget

        logger.info('grants.assessment.override.pending', {
          appId: ctx.appId,
          customerId: ctx.customerId,
          socketId: ctx.socketId,
          taskType: assessmentOutcome.result?.taskType,
          confidence: assessmentOutcome.result?.confidence,
          appliedBudget: assessmentOutcome.appliedBudget,
          durationMs: assessmentOutcome.durationMs,
          reason: assessmentOutcome.reason,
        })
      } else {
        // Log that override would have been applied but is disabled (dry run mode)
        logger.info('grants.assessment.override.dry_run', {
          appId: ctx.appId,
          customerId: ctx.customerId,
          socketId: ctx.socketId,
          taskType: assessmentOutcome.result?.taskType,
          confidence: assessmentOutcome.result?.confidence,
          wouldApplyBudget: assessmentOutcome.appliedBudget,
          durationMs: assessmentOutcome.durationMs,
          reason: assessmentOutcome.reason,
          enableAssessmentOverride: ctx.enableAssessmentOverride,
        })
      }
    }

    return result
  }
}

/**
 * Exhaustiveness check helper - ensures all cases are handled in switch statements.
 * If a new mode is added, TypeScript will error at compile time.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected assessment result mode: ${JSON.stringify(x)}`)
}
