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
import {
  AssessmentAgent,
  AssessmentOutcome,
  ClassifierMode,
  ClassificationResult,
  ConversationRole,
  ConversationTurn,
  MIN_CONFIDENCE_FOR_OVERRIDE,
  TASK_BUDGET_MAP,
} from '../agents/assessment-agent/index.js'
import { AssessmentTaskType, AssessmentReason, FixSessionPhase } from '../agents/assessment-agent/index.js'
import type { ILogger } from '../logging/types.js'
import { deriveUsedFreeGrants } from './assessment-executor.js'
import { manageFixSessionLifecycle } from './fix-session.js'
import { withTimeout } from '../utils/promise-utils.js'
import { reconcileBeforeTurnEnd } from '../workflow/index.js'
export type { ConversationTurn } from '../agents/assessment-agent/index.js'

type LifecycleLogger = Pick<ILogger, 'info' | 'warn' | 'debug' | 'error'>

/** Sliding window size for recent conversation turns (user + agent) passed to Haiku. */
const RECENT_MESSAGES_WINDOW = 6

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
 * These keyspaces don't collide. Per-turn bridging data (lastUserMessage,
 * lastAssessmentTaskType) is cleared at end-of-turn via clearTurnState.
 * Fix session state persists across turns and is reclaimed by
 * deactivateFixSession (turn guard or topic-change classification).
 * Abandoned fix sessions are bounded per-conversation and per-process.
 */
export class LifecycleSessionStore {
  private lastUserMessage = new Map<string, string>()
  private lastAssessmentTaskType = new Map<string, AssessmentTaskType>()
  private fixSessionPhase = new Map<string, FixSessionPhase>()
  private recentTurns = new Map<string, ConversationTurn[]>()
  private fixSessionTurnCount = new Map<string, number>()
  private lastTurnAgentAskedQuestion = new Map<string, boolean>()
  private lastTurnAgentMadeCodeChanges = new Map<string, boolean>()

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

  // --- Fix session state ---

  isFixSessionActive(sessionKey: string): boolean {
    return this.fixSessionPhase.has(sessionKey)
  }

  getFixSessionPhase(sessionKey: string): FixSessionPhase | undefined {
    return this.fixSessionPhase.get(sessionKey)
  }

  activateFixSession(sessionKey: string): void {
    this.fixSessionPhase.set(sessionKey, FixSessionPhase.Gathering)
    this.fixSessionTurnCount.set(sessionKey, 1)
  }

  transitionToAttempted(sessionKey: string): void {
    this.fixSessionPhase.set(sessionKey, FixSessionPhase.Attempted)
  }

  transitionToGathering(sessionKey: string): void {
    this.fixSessionPhase.set(sessionKey, FixSessionPhase.Gathering)
  }

  deactivateFixSession(sessionKey: string): void {
    this.fixSessionPhase.delete(sessionKey)
    this.fixSessionTurnCount.delete(sessionKey)
    this.recentTurns.delete(sessionKey)
    this.lastTurnAgentAskedQuestion.delete(sessionKey)
    this.lastTurnAgentMadeCodeChanges.delete(sessionKey)
  }

  incrementFixSessionTurns(sessionKey: string): number {
    const current = this.fixSessionTurnCount.get(sessionKey) ?? 0
    const next = current + 1
    this.fixSessionTurnCount.set(sessionKey, next)
    return next
  }

  getFixSessionTurnCount(sessionKey: string): number {
    return this.fixSessionTurnCount.get(sessionKey) ?? 0
  }

  // --- Conversation arc (user + agent turns) ---

  getRecentTurns(sessionKey: string): ConversationTurn[] {
    return [...(this.recentTurns.get(sessionKey) ?? [])]
  }

  pushTurn(sessionKey: string, turn: ConversationTurn): void {
    const turns = this.recentTurns.get(sessionKey) ?? []
    turns.push(turn)
    if (turns.length > RECENT_MESSAGES_WINDOW) {
      turns.shift()
    }
    this.recentTurns.set(sessionKey, turns)
  }

  // --- Agent question tracking (structural short-circuit) ---

  didLastTurnAgentAskQuestion(sessionKey: string): boolean {
    return this.lastTurnAgentAskedQuestion.get(sessionKey) ?? false
  }

  setLastTurnAgentAskedQuestion(sessionKey: string, asked: boolean): void {
    this.lastTurnAgentAskedQuestion.set(sessionKey, asked)
  }

  didLastTurnAgentMakeCodeChanges(sessionKey: string): boolean {
    return this.lastTurnAgentMadeCodeChanges.get(sessionKey) ?? false
  }

  setLastTurnAgentMadeCodeChanges(sessionKey: string, madeChanges: boolean): void {
    this.lastTurnAgentMadeCodeChanges.set(sessionKey, madeChanges)
  }

   /**
   * Clear ephemeral per-turn bridging data only. Called at the end of each turn.
   * Fix session state (fixSessionPhase, recentTurns, fixSessionTurnCount) and
   * agent signal flags (lastTurnAgentAskedQuestion, lastTurnAgentMadeCodeChanges) are intentionally preserved
   * while a session is active. recentTurns is reclaimed here when no session is active so
   * non-fix-session conversations don't accumulate entries indefinitely.
   */
  clearTurnState(sessionKey: string): void {
    this.lastUserMessage.delete(sessionKey)
    this.lastAssessmentTaskType.delete(sessionKey)
    if (!this.fixSessionPhase.has(sessionKey)) {
      this.recentTurns.delete(sessionKey)
    }
  }

  /**
   * Full teardown — clears all state including fix session.
   * Not yet called on SSE disconnect; wire here when TTL/eviction is added.
   */
  clearSession(sessionKey: string): void {
    this.lastUserMessage.delete(sessionKey)
    this.lastAssessmentTaskType.delete(sessionKey)
    this.fixSessionPhase.delete(sessionKey)
    this.recentTurns.delete(sessionKey)
    this.fixSessionTurnCount.delete(sessionKey)
    this.lastTurnAgentAskedQuestion.delete(sessionKey)
    this.lastTurnAgentMadeCodeChanges.delete(sessionKey)
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

interface FixSessionContext {
  fixSessionActive: boolean
  recentTurns: ConversationTurn[] | undefined
  fixSessionPhase: FixSessionPhase | undefined
  lastTurnAgentAskedQuestion: boolean | undefined
  lastTurnAgentMadeCodeChanges: boolean | undefined
}

function readFixSessionContext(sessionStore: LifecycleSessionStore, sessionKey: string, enableFixSession?: boolean): FixSessionContext {
  return {
    fixSessionActive: enableFixSession ? sessionStore.isFixSessionActive(sessionKey) : false,
    recentTurns: enableFixSession ? sessionStore.getRecentTurns(sessionKey) : undefined,
    fixSessionPhase: enableFixSession ? sessionStore.getFixSessionPhase(sessionKey) : undefined,
    lastTurnAgentAskedQuestion: enableFixSession ? sessionStore.didLastTurnAgentAskQuestion(sessionKey) : undefined,
    lastTurnAgentMadeCodeChanges: enableFixSession ? sessionStore.didLastTurnAgentMakeCodeChanges(sessionKey) : undefined,
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
  /** When true, enables fix session tracking (multi-turn fix context persistence). Derived from switchboard. */
  enableFixSession?: boolean
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
    enableFixSession,
  } = params

  if (!enableAssessmentAgent) return {}

  const previousUserMessage = params.previousUserMessage
    ?? sessionStore.getLastUserMessage(sessionKey)
  const previousAssessmentTaskType = params.previousAssessmentTaskType
    ?? sessionStore.getLastAssessmentTaskType(sessionKey)
  const fixCtx = readFixSessionContext(sessionStore, sessionKey, enableFixSession)

  let assessmentOutcome: AssessmentOutcome | undefined
  try {
    assessmentOutcome = await getAssessmentAgent().classify(message, {
      appId, customerId, socketId: sessionKey,
      enabledOverride: enableAssessmentAgent,
      previousUserMessage,
      previousAssessmentTaskType,
      isInitialPrompt,
      classifierMode,
      ...fixCtx,
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
  if (enableFixSession) sessionStore.pushTurn(sessionKey, { role: ConversationRole.user, content: message })
  if (assessmentOutcome.result?.taskType) {
    sessionStore.setLastAssessmentTaskType(sessionKey, assessmentOutcome.result.taskType)
  }

  // Fix session lifecycle management (gated by feature flag)
  if (enableFixSession) {
    manageFixSessionLifecycle(sessionStore, logger, sessionKey, appId, assessmentOutcome, classifierMode)
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
  /** Fallback when awaitOutcome times out: returns fix if LR agreed + fix session active, else undefined. */
  getTimeoutFallback(): AssessmentOutcome | undefined
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
    enableAssessmentAgent, classifierMode, enableFixSession,
  } = params

  if (!enableAssessmentAgent) {
    return { awaitOutcome: async () => undefined, getTimeoutFallback: () => undefined }
  }

  const previousUserMessage = params.previousUserMessage
    ?? sessionStore.getLastUserMessage(sessionKey)
  const previousAssessmentTaskType = params.previousAssessmentTaskType
    ?? sessionStore.getLastAssessmentTaskType(sessionKey)
  const fixCtx = readFixSessionContext(sessionStore, sessionKey, enableFixSession)

  let intermediateClassifierResult: ClassificationResult | undefined

  const promise = getAssessmentAgent().classify(message, {
    appId, customerId, socketId: sessionKey,
    enabledOverride: enableAssessmentAgent,
    previousUserMessage,
    previousAssessmentTaskType,
    isInitialPrompt,
    classifierMode,
    ...fixCtx,
    onClassifierResult: (result) => { intermediateClassifierResult = result },
  })

  // Seed the cache eagerly so the next turn gets multi-turn context even if
  // this turn never awaits (short-circuits on abort, transport error, etc.).
  sessionStore.setLastUserMessage(sessionKey, message)
  if (enableFixSession) sessionStore.pushTurn(sessionKey, { role: ConversationRole.user, content: message })

  promise.then(
    (outcome) => {
      if (outcome.result?.taskType) {
        sessionStore.setLastAssessmentTaskType(sessionKey, outcome.result.taskType)
      }
      logger.debug('assessment.parallel.resolved', {
        appId, sessionKey,
        taskType: outcome.result?.taskType,
        confidence: outcome.result?.confidence,
        fixSessionActive: enableFixSession ? sessionStore.isFixSessionActive(sessionKey) : false,
      })
    },
    (err) => {
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
      const outcome: AssessmentOutcome | undefined = result === null ? undefined : result
      if (outcome && enableFixSession) {
        manageFixSessionLifecycle(sessionStore, logger, sessionKey, appId, outcome, classifierMode)
      }
      return outcome
    },
    // Intentional billing inversion: when Haiku times out but LR already said Fix
    // AND an active fix session exists, bill to GoDaddy. Flag-gated by enableFixSession.
    getTimeoutFallback: () => {
      const lrSaidFix = intermediateClassifierResult?.taskType === AssessmentTaskType.Fix
      const fixSessionActive = enableFixSession && sessionStore.isFixSessionActive(sessionKey)

      if (!lrSaidFix || !fixSessionActive) return undefined

      const confidence = intermediateClassifierResult?.confidence ?? 0
      const meetsThreshold = confidence >= MIN_CONFIDENCE_FOR_OVERRIDE
      const budgetOverride = meetsThreshold ? TASK_BUDGET_MAP[AssessmentTaskType.Fix] : null

      logger.info('assessment.parallel.timeout_fallback', {
        appId, sessionKey,
        lrTaskType: intermediateClassifierResult?.taskType,
        lrConfidence: confidence,
        fixSessionActive: true,
        overrideApplied: !!budgetOverride,
      })

      return {
        result: { taskType: AssessmentTaskType.Fix, confidence },
        completedInTime: false,
        durationMs: 0,
        overrideApplied: !!budgetOverride,
        appliedBudget: budgetOverride ?? undefined,
        reason: AssessmentReason.EmbeddingTimeoutFallback,
      }
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
