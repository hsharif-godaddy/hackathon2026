/**
 * Fix session lifecycle management.
 *
 * Tracks whether a conversation is in an active "fix session" — a multi-turn
 * sequence where the user reported a bug and the agent is investigating/fixing.
 * Ensures follow-up messages within a fix session are correctly classified as
 * fix intent (attributed to GoDaddy) rather than general (charged to customer).
 *
 * State machine:
 *   No Session → gathering: Fix classified with confidence ≥65%
 *   gathering → attempted: Agent used code modification tools without asking a question
 *   attempted → ended: Haiku classifies General ≥80% (topic change / positive resolution)
 *   attempted → gathering: Haiku classifies Fix (user reports still broken)
 *   Any → ended: Turn count exceeds FIX_SESSION_MAX_TURNS (safety guard)
 */
import type { AssessmentOutcome, ClassifierMode } from '../agents/assessment-agent/index.js'
import { AssessmentReason, AssessmentTaskType, FixSessionPhase, MIN_CONFIDENCE_FOR_OVERRIDE } from '../agents/assessment-agent/index.js'
import { EDIT_TOOLS, WRITE_TOOLS, getEditorCommand, type ExecutionStep } from '@airo/ai-lib/budget'
import type { LifecycleSessionStore } from './message-lifecycle.js'
import type { ILogger } from '../logging/types.js'

type FixSessionLogger = Pick<ILogger, 'info' | 'warn' | 'debug' | 'error'>

// --- Constants ---

/** Confidence threshold for ending a fix session (General must exceed this). */
export const FIX_SESSION_END_CONFIDENCE = 80

/** Maximum turns before a fix session is auto-ended (safety guard). */
export const FIX_SESSION_MAX_TURNS = 5

// --- Execution step analysis ---

/** Tools that explicitly ask the user a question (stop-after tools that pause execution). */
const QUESTION_TOOLS: ReadonlySet<string> = new Set(['askQuestion', 'suggestedResponse'])

/** Editor commands that constitute a code modification (excludes 'view' which is read-only). */
const EDIT_COMMANDS: ReadonlySet<string> = new Set(['str_replace', 'insert', 'create'])

/** Returns true if any execution step called a question tool (askQuestion, suggestedResponse). */
export function agentAskedQuestion(steps: ExecutionStep[]): boolean {
  return steps.some(step =>
    step.content.some(item =>
      item.type === 'tool-call' && item.toolName != null && QUESTION_TOOLS.has(item.toolName)
    )
  )
}

/**
 * Returns true if any execution step made a code modification.
 * Checks EDIT_TOOLS (with command inspection to exclude 'view') and WRITE_TOOLS
 * (full file creation, no read-only variant).
 */
export function agentMadeCodeChanges(steps: ExecutionStep[]): boolean {
  return steps.some(step =>
    step.content.some(item => {
      if (item.type !== 'tool-call' || item.toolName == null) return false
      // WRITE_TOOLS (write_to_file) is always a code change — no read-only variant
      if (WRITE_TOOLS.has(item.toolName)) return true
      // EDIT_TOOLS requires command inspection: 'view' is read-only, absence assumes edit
      if (!EDIT_TOOLS.has(item.toolName)) return false
      const command = getEditorCommand(item.input ?? item.args)
      return command === undefined || EDIT_COMMANDS.has(command)
    })
  )
}

// --- Lifecycle management ---

/**
 * Manages fix session state transitions after classification completes.
 * Called from both blocking (runStartAssessment) and parallel (startParallelAssessment) paths.
 */
export function manageFixSessionLifecycle(
  sessionStore: LifecycleSessionStore,
  logger: FixSessionLogger,
  sessionKey: string,
  appId: string,
  assessmentOutcome: AssessmentOutcome,
  classifierMode?: ClassifierMode,
): void {
  const taskType = assessmentOutcome.result?.taskType
  const confidence = assessmentOutcome.result?.confidence ?? 0
  const reasoning = assessmentOutcome.result?.reasoning

  if (!taskType) return

  const wasActive = sessionStore.isFixSessionActive(sessionKey)
  const phase = sessionStore.getFixSessionPhase(sessionKey)

  if (!wasActive) {
    // START: activate fix session when classified as Fix with high confidence
    if (taskType === AssessmentTaskType.Fix && confidence >= MIN_CONFIDENCE_FOR_OVERRIDE) {
      sessionStore.activateFixSession(sessionKey)
      logger.info('fix_session.activated', {
        appId, sessionKey, confidence, classifierMode,
        reason: assessmentOutcome.reason,
      })
    }
    return
  }

  // Session is active — check turn guard
  const turnCount = sessionStore.incrementFixSessionTurns(sessionKey)
  if (turnCount >= FIX_SESSION_MAX_TURNS) {
    sessionStore.deactivateFixSession(sessionKey)
    logger.info('fix_session.ended.turn_guard', {
      appId, sessionKey, turnCount, phase,
      lastHaikuReasoning: reasoning,
    })
    return
  }

  // Phase-specific lifecycle transitions
  if (phase === FixSessionPhase.Attempted) {
    if (taskType === AssessmentTaskType.General && confidence >= FIX_SESSION_END_CONFIDENCE
        && assessmentOutcome.reason !== AssessmentReason.Timeout
        && assessmentOutcome.reason !== AssessmentReason.EmbeddingTimeoutFallback) {
      // END: clear topic change after fix attempt (only on deliberate Haiku classification, not timeout fallback)
      sessionStore.deactivateFixSession(sessionKey)
      logger.info('fix_session.ended.topic_change', {
        appId, sessionKey, turnCount,
        haikuConfidence: confidence,
        haikuReasoning: reasoning,
        phase,
      })
    } else if (taskType === AssessmentTaskType.Fix) {
      // RETRY: user reports still broken → back to gathering
      sessionStore.transitionToGathering(sessionKey)
      logger.info('fix_session.phase.gathering_retry', {
        appId, sessionKey, turnCount,
        haikuConfidence: confidence,
        haikuReasoning: reasoning,
      })
    }
    // General with confidence < 80% in attempted phase → stays attempted
  }
  // In gathering phase: no lifecycle changes from classification alone
  // (phase transitions happen post-execution in MessageExecutionService)
}
