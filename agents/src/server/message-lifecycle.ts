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
import type {
  AssessmentAgent,
  AssessmentOutcome,
  AssessmentTaskType,
  ClassifierMode,
} from '../agents/assessment-agent/index.js'
import type { ILogger } from '../logging/types.js'

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

  const willApply = !!(
    assessmentOutcome.overrideApplied &&
    assessmentOutcome.appliedBudget &&
    enableAssessmentOverride
  )

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

export interface EndHooksParams {
  appId: string
  conversationId?: string
  sessionKey: string
  reason: 'complete' | 'error' | 'disconnection'
  userPrompt?: string
  assessmentOutcome?: AssessmentOutcome
  enableAssessmentOverride: boolean
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
    assessmentOutcome, enableAssessmentOverride,
  } = params

  const usedFreeGrants =
    !!(assessmentOutcome?.overrideApplied && enableAssessmentOverride)

  let commitHash: string | null = null
  try {
    commitHash = await gitHookService.handleConnectionEnd(
      appId, reason, conversationId, sessionKey, userPrompt,
    )
  } catch (err) {
    logger.warn('message_lifecycle.git_hook.end.error', {
      appId, conversationId, sessionKey, reason,
      error: err instanceof Error ? err.message : String(err),
    })
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
