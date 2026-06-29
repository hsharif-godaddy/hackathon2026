import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { BudgetOverride, LlmCallSource } from '@airo/ai-grants'
import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'

import { Logger, log } from '../../logging/index.js'
import { getClassifier, getHaikuSystemPrompt, initializeAllClassifiers } from './classifier-factory.js'
import { TASK_BUDGET_MAP } from './keywords.js'
import {
  AssessmentTaskType,
  AssessmentReason,
  ConversationRole,
  HaikuAssessmentResultSchema,
  HaikuBinaryAssessmentResultSchema,
  ClassifierMode,
  FixSessionPhase,
  type AssessmentConfig,
  type AssessmentContext,
  type AssessmentOutcome,
  type AssessmentResult,
  type ClassificationResult,
  type ConversationTurn,
} from './types.js'

const logger = Logger.create({ component: 'assessment-agent' })

// &apos; omitted: content is placed in text nodes, not single-quoted attributes.
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}


/** Unified context passed to the Haiku tiebreaker. */
interface HaikuContext {
  /** The current user prompt to classify. */
  prompt: string
  /** Which classifier mode determines the system prompt variant. */
  mode: ClassifierMode
  /** Recent conversation turns (user + agent, oldest-first). Provides full conversation arc. */
  turns: ConversationTurn[]
  /** Present only when a fix session is active. Absence = no fix session. */
  fixSession?: { phase: FixSessionPhase }
  /** True when the agent's last turn explicitly asked a question (askQuestion/suggestedResponse tool). */
  agentAskedQuestion?: boolean
  /** True when the agent's last turn made code changes (edit/write tools). */
  agentMadeCodeChanges?: boolean
}

/**
 * Minimum confidence score to apply budget override.
 * Even if classified correctly, low confidence means don't override billing.
 * Exported for use by corpus-eval to ensure consistency.
 */
export const MIN_CONFIDENCE_FOR_OVERRIDE = 65

function resolveClassifierMode(context?: AssessmentContext): ClassifierMode {
  return context?.classifierMode ?? ClassifierMode.CosineSimilarity
}

/** Embedding/LR only emit fix vs general; unverified fix → general when Haiku cannot run. */
function taskTypeWhenHaikuUnavailable(result: ClassificationResult): AssessmentTaskType {
  if (result.taskType === AssessmentTaskType.Fix && result.requiresHaikuVerification) {
    return AssessmentTaskType.General
  }
  return result.taskType
}

/**
 * Orchestrates embedding/LR classification, optional Haiku tiebreaker, and outcome building.
 */
export class AssessmentClassifier {
  constructor(private config: AssessmentConfig) {}

  async initialize(): Promise<void> {
    // Pre-warm all classifiers so the first real request doesn't pay the initialization cost.
    await initializeAllClassifiers()
  }

  async classify(prompt: string, context?: AssessmentContext): Promise<AssessmentOutcome> {
    const startTime = Date.now()
    const mode = resolveClassifierMode(context)

    try {
      const impl = getClassifier(mode)
      const result = await impl.classify(prompt)

      context?.onClassifierResult?.(result)

      logger.info('assessment_agent.classifier.result', {
        appId: context?.appId,
        classifierMode: mode,
        taskType: result.taskType,
        confidence: result.confidence,
        similarity: result.similarity,
        hasNegation: result.hasNegation,
        requiresHaikuVerification: result.requiresHaikuVerification,
        durationMs: Date.now() - startTime,
      })

      const hasActiveNonGeneralSession = context?.previousAssessmentTaskType != null
        && context.previousAssessmentTaskType !== AssessmentTaskType.General

      const fixSessionNeedsHaiku = context?.fixSessionActive === true
        && result.taskType === AssessmentTaskType.General

      const sessionContextNeedsHaiku = (hasActiveNonGeneralSession || fixSessionNeedsHaiku)
        && result.taskType === AssessmentTaskType.General

      if (!result.requiresHaikuVerification && !sessionContextNeedsHaiku) {
        logger.info('assessment_agent.decision.fast_path', {
          appId: context?.appId,
          taskType: result.taskType,
          confidence: result.confidence,
          classifierMode: mode,
          reason: 'high_confidence_no_negation',
        })

        return this.buildOutcome(
          result.taskType,
          result.confidence,
          Date.now() - startTime,
          context,
          AssessmentReason.EmbeddingCompleted,
          { probFix: result.similarity, margin: result.margin, method: mode }
        )
      }

      const tiebreakerReason = result.hasNegation ? 'negation_detected'
        : fixSessionNeedsHaiku ? 'fix_session_gate'
        : sessionContextNeedsHaiku ? 'session_context_gate'
        : 'low_confidence'

      logger.info('assessment_agent.decision.haiku_needed', {
        appId: context?.appId,
        reason: tiebreakerReason,
        classifierMode: mode,
        confidence: result.confidence,
        taskType: result.taskType,
        hasNegation: result.hasNegation,
        includeSessionContext: hasActiveNonGeneralSession,
        fixSessionActive: context?.fixSessionActive,
        fixSessionPhase: context?.fixSessionPhase,
        remainingTimeMs: this.config.timeoutMs - (Date.now() - startTime),
      })

      return this.callHaikuTiebreaker(prompt, result, context, startTime, hasActiveNonGeneralSession)

    } catch (error) {
      const durationMs = Date.now() - startTime

      log.error(logger, 'assessment_agent.classify.error', error as Error, {
        appId: context?.appId,
        durationMs,
      })

      return {
        result: null,
        completedInTime: false,
        durationMs,
        overrideApplied: false,
        reason: AssessmentReason.Error,
      }
    }
  }

  private async callHaikuTiebreaker(
    prompt: string,
    classifierResult: ClassificationResult,
    context: AssessmentContext | undefined,
    startTime: number,
    sessionContextGated?: boolean
  ): Promise<AssessmentOutcome> {
    const elapsedMs = Date.now() - startTime
    const isParallel = resolveClassifierMode(context) === ClassifierMode.LogisticRegression
    const remainingTime = this.config.timeoutMs - elapsedMs

    logger.info('assessment_agent.haiku.start', {
      appId: context?.appId,
      elapsedMs,
      remainingTimeMs: isParallel ? undefined : remainingTime,
      timeoutMs: this.config.timeoutMs,
      parallelExecution: isParallel,
      classifierTaskType: classifierResult.taskType,
      classifierSimilarity: classifierResult.similarity,
    })

    try {
      if (!isParallel && remainingTime < 500) {
        const fallbackTaskType = taskTypeWhenHaikuUnavailable(classifierResult)
        const billingSafetyApplied = fallbackTaskType !== classifierResult.taskType

        logger.info('assessment_agent.haiku.skipped', {
          appId: context?.appId,
          reason: 'insufficient_time',
          remainingMs: remainingTime,
          minRequiredMs: 500,
          classifierTaskType: classifierResult.taskType,
          classifierConfidence: classifierResult.confidence,
          billingSafetyApplied,
          fallbackTaskType,
          sessionContextGated,
        })

        return this.buildOutcome(
          fallbackTaskType,
          billingSafetyApplied ? 100 : classifierResult.confidence,
          Date.now() - startTime,
          context,
          AssessmentReason.EmbeddingTimeoutFallback,
          {
            confidence: classifierResult.confidence,
            method: 'embedding-timeout-fallback',
            billingSafetyApplied,
            sessionContextGated,
          }
        )
      }

      const haikuContext: HaikuContext = {
        prompt,
        mode: resolveClassifierMode(context),
        turns: context?.recentTurns?.length
          ? context.recentTurns
          : context?.previousUserMessage ? [{ role: ConversationRole.user, content: context.previousUserMessage }] : [],
        fixSession: context?.fixSessionActive
          ? { phase: context.fixSessionPhase ?? FixSessionPhase.Gathering }
          : undefined,
        agentAskedQuestion: context?.lastTurnAgentAskedQuestion,
        agentMadeCodeChanges: context?.lastTurnAgentMadeCodeChanges,
      }

      logger.info('assessment_agent.haiku.calling', {
        appId: context?.appId,
        promptLength: prompt.length,
        turnCount: haikuContext.turns.length,
        fixSessionActive: !!haikuContext.fixSession,
        fixSessionPhase: haikuContext.fixSession?.phase,
        timeoutMs: isParallel ? undefined : remainingTime,
        parallelExecution: isParallel,
      })

      const haikuStartTime = Date.now()
      const haikuResult = isParallel
        ? await this.callHaiku(haikuContext)
        : await Promise.race([
          this.callHaiku(haikuContext),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), remainingTime)),
        ])
      const haikuDurationMs = Date.now() - haikuStartTime
      const totalDurationMs = Date.now() - startTime

      if (haikuResult === null) {
        const fallbackTaskType = taskTypeWhenHaikuUnavailable(classifierResult)
        const billingSafetyApplied = fallbackTaskType !== classifierResult.taskType

        logger.info('assessment_agent.haiku.timeout', {
          appId: context?.appId,
          haikuDurationMs,
          totalDurationMs,
          timeoutMs: remainingTime,
          classifierTaskType: classifierResult.taskType,
          classifierConfidence: classifierResult.confidence,
          billingSafetyApplied,
          fallbackTaskType,
        })

        return this.buildOutcome(
          fallbackTaskType,
          billingSafetyApplied ? 100 : classifierResult.confidence,
          totalDurationMs,
          context,
          AssessmentReason.Timeout,
          {
            confidence: classifierResult.confidence,
            method: 'embedding-haiku-timeout',
            billingSafetyApplied,
            sessionContextGated,
          }
        )
      }

      const agreesWithClassifier = haikuResult.taskType === classifierResult.taskType
      logger.info('assessment_agent.haiku.completed', {
        appId: context?.appId,
        haikuTaskType: haikuResult.taskType,
        haikuConfidence: haikuResult.confidence,
        haikuReasoning: haikuResult.reasoning,
        classifierTaskType: classifierResult.taskType,
        classifierSimilarity: classifierResult.similarity,
        agreesWithClassifier,
        haikuDurationMs,
        totalDurationMs,
      })

      return this.buildOutcome(
        haikuResult.taskType,
        haikuResult.confidence,
        totalDurationMs,
        context,
        AssessmentReason.LlmCompleted,
        {
          similarity: classifierResult.similarity,
          method: 'haiku-tiebreaker',
          reasoning: haikuResult.reasoning,
          agreesWithClassifier,
          haikuDurationMs,
          sessionContextGated,
        }
      )

    } catch (error) {
      const durationMs = Date.now() - startTime

      const fallbackTaskType = taskTypeWhenHaikuUnavailable(classifierResult)
      const billingSafetyApplied = fallbackTaskType !== classifierResult.taskType

      log.error(logger, 'assessment_agent.haiku.error', error as Error, {
        appId: context?.appId,
        durationMs,
        classifierTaskType: classifierResult.taskType,
        classifierConfidence: classifierResult.confidence,
        billingSafetyApplied,
        fallbackTaskType,
      })

      return this.buildOutcome(
        fallbackTaskType,
        billingSafetyApplied ? 100 : classifierResult.confidence,
        durationMs,
        context,
        AssessmentReason.Error,
        {
          confidence: classifierResult.confidence,
          method: 'embedding-haiku-error',
          billingSafetyApplied,
          sessionContextGated,
        }
      )
    }
  }

  private async callHaiku(context: HaikuContext): Promise<AssessmentResult> {
    const model = await getModel('haiku')

    const metadata: LitellmMetadata = {
      user: BudgetOverride.AssessAgent,
      tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:haiku-tiebreaker'],
    }

    const { prompt, mode, turns, fixSession, agentAskedQuestion, agentMadeCodeChanges } = context

    return llmMetadataContext.run(metadata, async () => {
      const truncatedPrompt = prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt
      const truncatedTurns = turns.map(t => ({
        role: t.role,
        content: t.content.length > 150 ? t.content.substring(0, 150) + '...' : t.content,
      }))

      let fullPrompt = ''
      if (fixSession) {
        fullPrompt += `<fix_session_active>true</fix_session_active>\n`
          + `<fix_session_phase>${fixSession.phase}</fix_session_phase>\n`
      }
      if (agentAskedQuestion) {
        fullPrompt += `<agent_asked_question>true</agent_asked_question>\n`
      }
      if (agentMadeCodeChanges) {
        fullPrompt += `<agent_made_code_changes>true</agent_made_code_changes>\n`
      }
      if (truncatedTurns.length > 0) {
        fullPrompt += `<conversation_history>\n${truncatedTurns.map((t, i) => `<turn index="${i}" role="${t.role}">${escapeXml(t.content)}</turn>`).join('\n')}\n</conversation_history>\n`
      }
      fullPrompt += `<user_prompt>\n${escapeXml(truncatedPrompt)}\n</user_prompt>`

      const response = await generateText({
        model,
        system: getHaikuSystemPrompt(mode, !!fixSession),
        prompt: fullPrompt,
        temperature: 0,
        maxOutputTokens: 150,
        experimental_telemetry: { isEnabled: true, functionId: 'assessment-agent-tiebreaker' },
      })

      const result = this.parseHaikuResponse(response.text, mode)

      if (fixSession) {
        logger.info('fix_session.haiku_result', {
          haikuTaskType: result.taskType,
          haikuConfidence: result.confidence,
          haikuReasoning: result.reasoning,
          fixSessionPhase: fixSession.phase,
        })
      }

      return result
    })
  }

  private parseHaikuResponse(text: string, mode: ClassifierMode): AssessmentResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        logger.warn('assessment_agent.haiku.parse_no_json', { preview: text.slice(0, 120) })
        return { taskType: AssessmentTaskType.General, confidence: 100 }
      }

      const parsed = JSON.parse(jsonMatch[0])
      const schema = mode === ClassifierMode.LogisticRegression
        ? HaikuBinaryAssessmentResultSchema
        : HaikuAssessmentResultSchema
      const validated = schema.safeParse(parsed)

      if (validated.success) {
        return validated.data
      }

      logger.warn('assessment_agent.haiku.parse_schema_fail', {
        preview: text.slice(0, 120),
        zodError: validated.error.message,
      })
      return { taskType: AssessmentTaskType.General, confidence: 100 }
    } catch (err: unknown) {
      logger.warn('assessment_agent.haiku.parse_error', {
        preview: text.slice(0, 120),
        error: err instanceof Error ? err.message : String(err),
      })
      return { taskType: AssessmentTaskType.General, confidence: 100 }
    }
  }

  buildOutcome(
    taskType: AssessmentTaskType,
    confidence: number,
    durationMs: number,
    context: AssessmentContext | undefined,
    reason: AssessmentReason,
    extra?: Record<string, unknown>
  ): AssessmentOutcome {
    const result: AssessmentResult = { taskType, confidence }
    const meetsThreshold = confidence >= this.config.confidenceThreshold
    const budgetOverride = meetsThreshold ? TASK_BUDGET_MAP[taskType] : null

    this.logOutcome(reason, result, durationMs, context, budgetOverride, extra)

    return {
      result,
      completedInTime: reason !== AssessmentReason.Timeout,
      durationMs,
      overrideApplied: !!budgetOverride,
      appliedBudget: budgetOverride ?? undefined,
      reason,
    }
  }

  private logOutcome(
    reason: AssessmentReason,
    result: AssessmentResult | null,
    durationMs: number,
    context: AssessmentContext | undefined,
    appliedBudget: BudgetOverride | null,
    extra?: Record<string, unknown>
  ): void {
    if (appliedBudget) {
      logger.info('grants.assessment.override_applied', {
        appId: context?.appId,
        customerId: context?.customerId,
        socketId: context?.socketId,
        taskType: result?.taskType,
        confidence: result?.confidence,
        appliedBudget,
        originalSubscriptionId: 'customer_grants',
        newSubscriptionId: appliedBudget,
        durationMs,
        reason,
        ...extra,
      })
    } else if (result?.taskType === AssessmentTaskType.Fix) {
      logger.info('grants.assessment.override_skipped', {
        appId: context?.appId,
        taskType: result?.taskType,
        confidence: result?.confidence,
        confidenceThreshold: this.config.confidenceThreshold,
        reason: result.confidence < this.config.confidenceThreshold
          ? 'confidence_below_threshold'
          : 'no_budget_mapping',
        durationMs,
      })
    }

    logger.info('assessment_agent.classify.complete', {
      appId: context?.appId,
      customerId: context?.customerId,
      socketId: context?.socketId,
      taskType: result?.taskType ?? 'unknown',
      confidence: result?.confidence,
      reason,
      overrideApplied: !!appliedBudget,
      appliedBudget: appliedBudget ?? 'none',
      durationMs,
      completedInTime: reason !== AssessmentReason.Timeout,
      ...extra,
    })
  }
}
