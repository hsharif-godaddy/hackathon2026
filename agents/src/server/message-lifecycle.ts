/**
 * Shared per-message lifecycle hooks used by both WS and SSE transports.
 *
 * Orchestrates cross-cutting work that runs around every agent turn:
 *   - Git hook: create feature branch at message start, squash-merge on end
 *   - Assessment agent: classify the prompt and queue a task-specific budget
 *     override when a free-task (publish/domain/fix) is detected
 *   - usedFreeGrants accounting: did an override actually get applied?
 *
 * WS wires these via ai-transport callbacks; SSE calls them directly from
 * `MessageExecutionService.execute`. Multi-turn caches (previous message,
 * previous task type) are owned by the caller since each transport uses a
 * different session-key shape.
 */
import type { GitHookService } from '../services/git-hook-service.js'
import { gitOpsService } from '../services/GitOpsService.js'
import type {
  AssessmentAgent,
  AssessmentOutcome,
  AssessmentTaskType,
  ClassifierMode,
} from '../agents/assessment-agent/index.js'
import type { ILogger } from '../logging/types.js'
import { deriveUsedFreeGrants } from './assessment-executor.js'
import { withTimeout } from '../utils/promise-utils.js'
import { reconcileBeforeTurnEnd } from '../workflow/index.js'

type LifecycleLogger = Pick<ILogger, 'info' | 'warn' | 'debug' | 'error'>

/**
 * Per-session cache for assessment multi-turn context. Both transports share
 * a single instance via `MessageLifecycleDeps` so follow-up classification
 * ("it doesn't work" after "fix my button") has the prior message + task
 * type regardless of which transport delivered each turn.
 *
 * Session keys:
 *   - WS : the Socket.IO `socketId` (ephemeral, per-connection)
 *   - SSE: `sse:${conversationId}` (stable across HTTP requests for one convo)
 *
 * These keyspaces don't collide. Entries are pruned by the transport on
 * disconnect (WS) or explicit clear (SSE); the store itself doesn't TTL.
 */
export class LifecycleSessionStore {
  private lastUserMessage = new Map<string, string>()
  private lastAssessmentTaskType = new Map<string, AssessmentTaskType>()

  getLastUserMessage(sessionKey: string): string | undefined {
    return this.lastUserMessage.get(sessionKey)
  }
  setLastUserMessage(sessionKey: string, message: string): void {
    this.lastUserMessage.set(sessionKey, message)
  }

  getLastAssessmentTaskType(sessionKey: string): AssessmentTaskType | undefined {
    return this.lastAssessmentTaskType.get(sessionKey)
  }
  setLastAssessmentTaskType(sessionKey: string, taskType: AssessmentTaskType): void {
    this.lastAssessmentTaskType.set(sessionKey, taskType)
  }

  clearSession(sessionKey: string): void {
    this.lastUserMessage.delete(sessionKey)
    this.lastAssessmentTaskType.delete(sessionKey)
  }
}

export interface MessageLifecycleDeps {
  gitHookService: GitHookService
  getAssessmentAgent: () => AssessmentAgent
  sessionStore: LifecycleSessionStore
  logger: LifecycleLogger
}

export interface StartGitHookParams {
  appId: string
  conversationId?: string
  sessionKey: string
  message: string
}

/** Non-throwing wrapper around gitHookService.handleMessageStart. */
export async function runStartGitHook(
  deps: Pick<MessageLifecycleDeps, 'gitHookService' | 'logger'>,
  params: StartGitHookParams,
): Promise<void> {
  const { gitHookService, logger } = deps
  const { appId, conversationId, sessionKey, message } = params
  try {
    await gitHookService.handleMessageStart(appId, conversationId, sessionKey, message)
  } catch (err) {
    logger.warn('message_lifecycle.git_hook.start.error', {
      appId, conversationId, sessionKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export interface StartAssessmentParams {
  appId: string
  sessionKey: string
  message: string
  customerId?: string
  isInitialPrompt: boolean
  enableAssessmentAgent: boolean
  enableAssessmentOverride: boolean
  /**
   * Override for the previous user message. When omitted, the helper reads
   * from the shared `sessionStore`. Useful for WS which may also fall back
   * to a DB lookup on reconnect before calling the helper.
   */
  previousUserMessage?: string
  /** Override for previous task type; falls back to the store when omitted. */
  previousAssessmentTaskType?: AssessmentTaskType
  /** Which classifier to use (derived from switchboard via JWT). Defaults to cosine-similarity when absent. */
  classifierMode?: ClassifierMode
}

export interface StartAssessmentResult {
  assessmentOutcome?: AssessmentOutcome
  /** subscriptionId to apply when the assessment determined an override AND the flag is enabled. */
  budgetOverrideSubscriptionId?: string
}

/**
 * Whether an assessment outcome warrants applying a budget override. True when
 * the classifier flagged a free-task, produced a budget string, and the
 * override flag is enabled. Used by both the blocking (grants) and early-await
 * (SSE grants) paths to decide whether to write `appliedBudget` into
 * `metadata.subscriptionId`.
 */
export function isOverrideApplicable(
  outcome: AssessmentOutcome | undefined,
  enableAssessmentOverride: boolean,
): boolean {
  return !!(outcome?.overrideApplied && outcome?.appliedBudget && enableAssessmentOverride)
}

/**
 * Classify the prompt and emit pending/dry-run logs. Returns the outcome plus
 * any subscriptionId override the caller should apply to executionContext.
 * When `enableAssessmentAgent` is false, returns an empty result without
 * invoking the assessment agent.
 */
export async function runStartAssessment(
  deps: Pick<MessageLifecycleDeps, 'getAssessmentAgent' | 'sessionStore' | 'logger'>,
  params: StartAssessmentParams,
): Promise<StartAssessmentResult> {
  const { getAssessmentAgent, sessionStore, logger } = deps
  const {
    appId, sessionKey, message, customerId, isInitialPrompt,
    enableAssessmentAgent, enableAssessmentOverride, classifierMode,
  } = params

  if (!enableAssessmentAgent) return {}

  const previousUserMessage = params.previousUserMessage
    ?? sessionStore.getLastUserMessage(sessionKey)
  const previousAssessmentTaskType = params.previousAssessmentTaskType
    ?? sessionStore.getLastAssessmentTaskType(sessionKey)

  let assessmentOutcome: AssessmentOutcome | undefined
  try {
    assessmentOutcome = await getAssessmentAgent().classify(message, {
      appId, customerId, socketId: sessionKey,
      enabledOverride: enableAssessmentAgent,
      previousUserMessage,
      previousAssessmentTaskType,
      isInitialPrompt,
      classifierMode,
    })
  } catch (err) {
    logger.warn('message_lifecycle.assessment.classify.error', {
      appId, sessionKey,
      error: err instanceof Error ? err.message : String(err),
    })
    return {}
  }

  // Seed the shared cache so the next turn on this session has multi-turn context.
  sessionStore.setLastUserMessage(sessionKey, message)
  if (assessmentOutcome.result?.taskType) {
    sessionStore.setLastAssessmentTaskType(sessionKey, assessmentOutcome.result.taskType)
  }

  const willApply = isOverrideApplicable(assessmentOutcome, enableAssessmentOverride)

  if (willApply && assessmentOutcome.appliedBudget) {
    logger.info('grants.assessment.override.pending', {
      appId, customerId, socketId: sessionKey,
      taskType: assessmentOutcome.result?.taskType,
      confidence: assessmentOutcome.result?.confidence,
      appliedBudget: assessmentOutcome.appliedBudget,
      durationMs: assessmentOutcome.durationMs,
      reason: assessmentOutcome.reason,
    })
  } else if (assessmentOutcome.overrideApplied && assessmentOutcome.appliedBudget) {
    logger.info('grants.assessment.override.dry_run', {
      appId, customerId, socketId: sessionKey,
      taskType: assessmentOutcome.result?.taskType,
      confidence: assessmentOutcome.result?.confidence,
      wouldApplyBudget: assessmentOutcome.appliedBudget,
      durationMs: assessmentOutcome.durationMs,
      reason: assessmentOutcome.reason,
      enableAssessmentOverride,
    })
  }

  return {
    assessmentOutcome,
    ...(willApply && assessmentOutcome.appliedBudget && {
      budgetOverrideSubscriptionId: assessmentOutcome.appliedBudget,
    }),
  }
}

export interface ParallelAssessmentHandle {
  /**
   * Await the classifier with a timeout.
   *
   * Returns the resolved outcome, or `undefined` on timeout or classifier
   * rejection. Safe to call multiple times — the underlying classifier
   * promise is shared, so a second call on an already-resolved outcome
   * returns immediately (the inner timer is scheduled but cleared in the
   * same microtask). A second call on a still-pending classifier will arm
   * its own timer; SSE's usage pattern only awaits once per turn so this
   * doesn't fire in practice.
   */
  awaitOutcome(opts: { timeoutMs: number }): Promise<AssessmentOutcome | undefined>
}

/**
 * Fire the assessment classifier non-blocking. Intended for BMS callers
 * (budget service mode) where cost attribution happens post-turn via the
 * budget report — so the main agent turn does not need to wait for the
 * classifier before starting.
 *
 * Eagerly populates the shared sessionStore when the classifier resolves so
 * the next turn on this session has multi-turn context regardless of whether
 * the current caller ever awaits the outcome.
 */
export function startParallelAssessment(
  deps: Pick<MessageLifecycleDeps, 'getAssessmentAgent' | 'sessionStore' | 'logger'>,
  params: StartAssessmentParams,
): ParallelAssessmentHandle {
  const { getAssessmentAgent, sessionStore, logger } = deps
  const {
    appId, sessionKey, message, customerId, isInitialPrompt,
    enableAssessmentAgent, classifierMode,
  } = params

  if (!enableAssessmentAgent) {
    return { awaitOutcome: async () => undefined }
  }

  const previousUserMessage = params.previousUserMessage
    ?? sessionStore.getLastUserMessage(sessionKey)
  const previousAssessmentTaskType = params.previousAssessmentTaskType
    ?? sessionStore.getLastAssessmentTaskType(sessionKey)

  const promise = getAssessmentAgent().classify(message, {
    appId, customerId, socketId: sessionKey,
    enabledOverride: enableAssessmentAgent,
    previousUserMessage,
    previousAssessmentTaskType,
    isInitialPrompt,
    classifierMode,
  })

  // Seed the cache eagerly so the next turn gets multi-turn context even if
  // this turn never awaits (short-circuits on abort, transport error, etc.).
  sessionStore.setLastUserMessage(sessionKey, message)

  promise.then(
    (outcome) => {
      if (outcome.result?.taskType) {
        sessionStore.setLastAssessmentTaskType(sessionKey, outcome.result.taskType)
      }
      logger.debug('assessment.parallel.resolved', {
        appId, sessionKey,
        taskType: outcome.result?.taskType,
        confidence: outcome.result?.confidence,
      })
    },
    (err) => {
      // Match the blocking path (runStartAssessment) severity — both represent
      // the same class of transient LLM/network failure, so both should or
      // neither should page on-call.
      logger.warn('assessment.parallel.rejected', {
        appId, sessionKey,
        error: err instanceof Error ? err.message : String(err),
      })
    },
  )

  // Swallow rejections once so awaitOutcome can just time-race a never-rejecting
  // promise, rather than juggling pre- vs post-timeout rejection handling.
  const swallowed = promise.catch((): AssessmentOutcome | undefined => undefined)

  return {
    awaitOutcome: async ({ timeoutMs }) => {
      const result = await withTimeout(
        swallowed,
        timeoutMs,
        () => logger.warn('assessment.parallel.timeout', { appId, sessionKey, timeoutMs }),
        // `swallowed = promise.catch(() => undefined)` is the invariant that
        // makes this no-op safe: the wrapped promise can never reject, so
        // withTimeout's late-rejection path is unreachable. Keep the swallow
        // in sync with this handler if the rejection model changes.
        () => { /* unreachable — swallowed never rejects */ },
      )
      // withTimeout returns null on timeout; normalize to undefined so callers
      // have a single "outcome unavailable" sentinel.
      return result === null ? undefined : result
    },
  }
}

export interface EndHooksParams {
  appId: string
  conversationId?: string
  sessionKey: string
  reason: 'complete' | 'error' | 'disconnection'
  userPrompt?: string
  assessmentOutcome?: AssessmentOutcome
  enableAssessmentOverride: boolean
  budgetServiceEnabled: boolean
}

export interface EndHooksResult {
  commitHash: string | null
  usedFreeGrants: boolean
}

export async function runMessageEndHooks(
  deps: MessageLifecycleDeps,
  params: EndHooksParams,
): Promise<EndHooksResult> {
  const { gitHookService, logger } = deps
  const {
    appId, conversationId, sessionKey, reason, userPrompt,
    assessmentOutcome, enableAssessmentOverride, budgetServiceEnabled,
  } = params

  const usedFreeGrants = deriveUsedFreeGrants(
    budgetServiceEnabled, assessmentOutcome, enableAssessmentOverride,
  )

  let excludeFiles: string[] = []
  try {
    excludeFiles = await reconcileBeforeTurnEnd(appId)
    if (excludeFiles.length > 0) {
      logger.warn('message_lifecycle.reconcile.partial', { appId, unrevertedFiles: excludeFiles })
    }
  } catch (err: unknown) {
    logger.warn('message_lifecycle.reconcile.error', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
  }

  let commitHash: string | null = null
  try {
    commitHash = await gitHookService.handleConnectionEnd(
      appId, reason, conversationId, sessionKey, userPrompt, excludeFiles,
    )
  } catch (err) {
    logger.warn('message_lifecycle.git_hook.end.error', {
      appId, conversationId, sessionKey, reason,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fire-and-forget: trigger auto-push if sync_strategy is on_commit
  if (commitHash && reason === 'complete') {
    gitOpsService.triggerAutoSync(appId, 'on_commit').catch(() => {})
  }

  if (usedFreeGrants && reason === 'complete') {
    logger.info('grants.assessment.free_task_completed', {
      appId, socketId: sessionKey,
      taskType: assessmentOutcome?.result?.taskType,
      appliedBudget: assessmentOutcome?.appliedBudget,
    })
  }

  return { commitHash, usedFreeGrants }
}
