import { Logger } from '../../logging/index.js'

import {
  AssessmentClassifier,
  MIN_CONFIDENCE_FOR_OVERRIDE,
} from './assessment-classifier.js'
import {
  AssessmentTaskType,
  AssessmentReason,
  ClassifierMode,
  type AssessmentConfig,
  type AssessmentContext,
  type AssessmentOutcome,
  type ABComparisonResult,
  type CostPrediction,
} from './types.js'

export { MIN_CONFIDENCE_FOR_OVERRIDE }

const logger = Logger.create({ component: 'assessment-agent' })

const DEFAULT_CONFIG: AssessmentConfig = {
  timeoutMs: 3500,  // Allow time for Haiku fallback (embedding ~1000ms + Haiku ~2500ms)
  confidenceThreshold: MIN_CONFIDENCE_FOR_OVERRIDE,
  enabled: false,
}

export class AssessmentAgent {
  private config: AssessmentConfig
  private initialized: boolean = false
  private classifier: AssessmentClassifier

  constructor(config?: Partial<AssessmentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.classifier = new AssessmentClassifier(this.config)
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    logger.info('assessment_agent.initialization.start', {})

    try {
      await this.classifier.initialize()
      this.initialized = true
      logger.info('assessment_agent.initialization.complete', {})
    } catch (error) {
      logger.error('assessment_agent.initialization.error', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Still mark as initialized to prevent retry loops
      //todo seems dangerous revisit later
      this.initialized = true
    }
  }

  async classify(prompt: string, context?: AssessmentContext): Promise<AssessmentOutcome> {
    const startTime = Date.now()
    const isEnabled = context?.enabledOverride !== undefined
      ? context.enabledOverride
      : this.config.enabled

    logger.info('assessment_agent.classify.start', {
      appId: context?.appId,
      customerId: context?.customerId,
      socketId: context?.socketId,
      enabled: isEnabled,
      promptLength: prompt?.length || 0,
      promptPreview: prompt?.substring(0, 100) || '',
      classifierMode: context?.classifierMode ?? ClassifierMode.CosineSimilarity,
      config: {
        timeoutMs: this.config.timeoutMs,
        confidenceThreshold: this.config.confidenceThreshold,
      },
    })

    if (!isEnabled) {
      logger.info('assessment_agent.classify.skipped', {
        appId: context?.appId,
        reason: 'disabled',
        enabledOverride: context?.enabledOverride,
        configEnabled: this.config.enabled,
      })
      return {
        result: null,
        completedInTime: false,
        durationMs: 0,
        overrideApplied: false,
        reason: AssessmentReason.Disabled,
      }
    }

    if (!prompt || prompt.trim().length === 0) {
      logger.info('assessment_agent.classify.skipped', {
        appId: context?.appId,
        reason: 'empty_prompt',
      })
      return {
        result: { taskType: AssessmentTaskType.General, confidence: 100 },
        completedInTime: true,
        durationMs: 0,
        overrideApplied: false,
        reason: AssessmentReason.EmptyPrompt,
      }
    }

    // Initial prompts are always creation intent - skip classification entirely.
    // By definition, you can't publish/fix/domain an app that doesn't exist yet.
    if (context?.isInitialPrompt) {
      logger.info('assessment_agent.classify.initial_prompt', {
        appId: context?.appId,
        reason: 'initial_prompt_always_general',
        promptPreview: prompt.substring(0, 100),
      })
      return {
        result: { taskType: AssessmentTaskType.General, confidence: 100 },
        completedInTime: true,
        durationMs: Date.now() - startTime,
        overrideApplied: false,
        reason: AssessmentReason.InitialPrompt,
      }
    }

    return this.classifier.classify(prompt, context)
  }

  /**
   * Run a full A/B comparison between two classifier modes.
   * Each arm runs the complete pipeline independently (embedding → optional Haiku → outcome).
   * For local use only — the websocket server never calls this method.
   *
   * @param prompt - The user prompt to classify
   * @param modelA - First classifier mode
   * @param modelB - Second classifier mode
   * @param context - Optional context forwarded to Haiku for session gating. Passing undefined is valid.
   */
  async runABClassification(
    prompt: string,
    modelA: ClassifierMode,
    modelB: ClassifierMode,
    context?: AssessmentContext
  ): Promise<ABComparisonResult> {
    const [outcomeA, outcomeB] = await Promise.all([
      this.classifier.classify(prompt, { ...context, classifierMode: modelA }),
      this.classifier.classify(prompt, { ...context, classifierMode: modelB }),
    ])

    const result: ABComparisonResult = {
      modelA,
      modelB,
      outcomeA,
      outcomeB,
      taskTypeAgree: outcomeA.result?.taskType === outcomeB.result?.taskType,
      overrideAgree: outcomeA.overrideApplied === outcomeB.overrideApplied,
      haikuEscalationAgree: outcomeA.reason === outcomeB.reason,
      confidenceDelta: (outcomeA.result?.confidence ?? 0) - (outcomeB.result?.confidence ?? 0),
      latencyDeltaMs: outcomeA.durationMs - outcomeB.durationMs,
    }

    logger.info('assessment_agent.ab_comparison', {
      modelA,
      modelB,
      taskTypeAgree: result.taskTypeAgree,
      overrideAgree: result.overrideAgree,
      haikuEscalationAgree: result.haikuEscalationAgree,
      confidenceDelta: result.confidenceDelta,
      latencyDeltaMs: result.latencyDeltaMs,
      outcomeATaskType: outcomeA.result?.taskType,
      outcomeBTaskType: outcomeB.result?.taskType,
      outcomeAConfidence: outcomeA.result?.confidence,
      outcomeBConfidence: outcomeB.result?.confidence,
      outcomeAReason: outcomeA.reason,
      outcomeBReason: outcomeB.reason,
    })

    return result
  }

  getName(): string {
    return 'Assessment Agent'
  }

  async cleanup(): Promise<void> {
    logger.info('assessment_agent.cleanup.complete', {})
  }

  async predictCost(_prompt: string, _context?: AssessmentContext): Promise<CostPrediction> {
    throw new Error('Not implemented')
  }
}

let assessmentAgent: AssessmentAgent | null = null

export function getAssessmentAgent(): AssessmentAgent {
  if (!assessmentAgent) {
    assessmentAgent = new AssessmentAgent()
  }
  return assessmentAgent
}

export function createAssessmentAgent(config?: Partial<AssessmentConfig>): AssessmentAgent {
  return new AssessmentAgent(config)
}
