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
  HaikuAssessmentResultSchema,
  HaikuBinaryAssessmentResultSchema,
  ClassifierMode,
  type AssessmentConfig,
  type AssessmentContext,
  type AssessmentOutcome,
  type AssessmentResult,
  type ClassificationResult,
} from './types.js'

const logger = Logger.create({ component: 'assessment-agent' })

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

      const sessionContextNeedsHaiku = hasActiveNonGeneralSession
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
    const remainingTime = this.config.timeoutMs - elapsedMs

    logger.info('assessment_agent.haiku.start', {
      appId: context?.appId,
      elapsedMs,
      remainingTimeMs: remainingTime,
      timeoutMs: this.config.timeoutMs,
      classifierTaskType: classifierResult.taskType,
      classifierSimilarity: classifierResult.similarity,
    })

    try {
      if (remainingTime < 500) {
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

      const previousMessage = context?.previousUserMessage
      logger.info('assessment_agent.haiku.calling', {
        appId: context?.appId,
        promptLength: prompt.length,
        hasPreviousContext: !!previousMessage,
        previousMessagePreview: previousMessage?.substring(0, 50),
        timeoutMs: remainingTime,
      })

      const haikuStartTime = Date.now()
      const haikuResult = await Promise.race([
        this.callHaiku(prompt, resolveClassifierMode(context), previousMessage),
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

  /**
   * Call Haiku for classification
   * @param prompt - Current user message
   * @param mode - Classifier mode, used to select the appropriate system prompt
   * @param previousMessage - Optional previous user message for multi-turn context
   */
  private async callHaiku(prompt: string, mode: ClassifierMode, previousMessage?: string): Promise<AssessmentResult> {
    const model = await getModel('haiku')

    const metadata: LitellmMetadata = {
      user: BudgetOverride.AssessAgent,
      tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:haiku-tiebreaker'],
    }

    return llmMetadataContext.run(metadata, async () => {
      const truncatedPrompt = prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt
      const truncatedPrevious = previousMessage && previousMessage.length > 200
        ? previousMessage.substring(0, 200) + '...'
        : previousMessage

      const fullPrompt = truncatedPrevious
        ? `<previous_message>\n${truncatedPrevious}\n</previous_message>\n<user_prompt>\n${truncatedPrompt}\n</user_prompt>`
        : `<user_prompt>\n${truncatedPrompt}\n</user_prompt>`

      const response = await generateText({
        model,
        system: getHaikuSystemPrompt(mode),
        prompt: fullPrompt,
        temperature: 0,
        maxOutputTokens: 150,
        experimental_telemetry: { isEnabled: true, functionId: 'assessment-agent-tiebreaker' },
      })

      return this.parseHaikuResponse(response.text, mode)
    })
  }

  private parseHaikuResponse(text: string, mode: ClassifierMode): AssessmentResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
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

      return { taskType: AssessmentTaskType.General, confidence: 100 }
    } catch {
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
