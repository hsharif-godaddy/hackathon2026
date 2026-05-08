/**
 * Logistic Regression classifier for fast, embedding-based task classification.
 *
 * Loads pre-trained LR weights from models/lr-embedding-weights.json (trained offline
 * on text-embedding-3-small embeddings). Inference is a single dot product + sigmoid —
 * ~1ms of CPU after the embedding call, with no example storage overhead.
 *
 * Trained on 3404 examples: 94.97% CV accuracy, F1-fix: 0.908, F1-general: 0.965
 *
 * Outputs `requiresHaikuVerification: true` when confidence ≤ 80 or negation is detected.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateEmbeddings, getEmbeddingModel, type EmbeddingModel } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { BudgetOverride, LlmCallSource } from '@airo/ai-grants'

import { Logger } from '../../logging/index.js'
import { NEGATION_PATTERNS } from './keywords.js'
import { AssessmentTaskType, type ClassificationResult, type IClassifier } from './types.js'

const logger = Logger.create({ component: 'lr-classifier' })

/** Local weights + file read only; transient failure is unlikely, so few attempts then give up. */
const INIT_MAX_ATTEMPTS = 3

const MAX_PROMPT_LENGTH = 2000

// LR confidence above which we trust the model without Haiku verification (0–100 scale)
const HIGH_CONFIDENCE = 80

/** Used when artifact omits or has an invalid `metadata.threshold`. */
const DEFAULT_DECISION_THRESHOLD = 0.5

interface LRWeights {
  weights: number[]
  bias: number
  /** Reserved for future PCA-reduced retrains; classify() does not apply the transform yet. */
  pca: null | { components: number[][]; mean: number[] }
  metadata: {
    trainSize: number
    accuracy: number
    cvAccuracy: number
    f1Fix: number
    f1General: number
    regularizationC: number
    threshold: number
    pcaDimensions: number | null
    pcaVarianceRetained: number | null
    trainedAt: string
  }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return sum
}

function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  return norm === 0 ? vec : vec.map((v) => v / norm)
}

function decisionThresholdFromMetadata(metadata: LRWeights['metadata'] | undefined): number {
  const t = metadata?.threshold
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t >= 1) {
    logger.warn('lr_classifier.threshold.invalid_fallback', {
      threshold: t,
      fallback: DEFAULT_DECISION_THRESHOLD,
    })
    return DEFAULT_DECISION_THRESHOLD
  }
  return t
}

/** General + confidence 0: no grant override; `requiresHaikuVerification` sends the prompt to Haiku. */

function lrDegradedClassification(prompt: string): ClassificationResult {
  return {
    taskType: AssessmentTaskType.General,
    confidence: 0,
    similarity: 0,
    matchedExample: '',
    margin: 0,
    method: 'embedding-lr',
    hasNegation: NEGATION_PATTERNS.test(prompt),
    requiresHaikuVerification: true,
  }
}

export class LRClassifier implements IClassifier {
  private weights: number[] = []
  private bias = 0
  private decisionThreshold = DEFAULT_DECISION_THRESHOLD
  private embeddingModel: EmbeddingModel | null = null
  private initialized = false
  /** Coalesces concurrent `initialize()` calls; retries stay inside a single `doInitialize()` run. */
  private initializationPromise: Promise<void> | null = null

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = this.doInitialize()
    return this.initializationPromise
  }

  private async doInitialize(): Promise<void> {
    const startTime = Date.now()
    logger.info('lr_classifier.initialization.start', { maxAttempts: INIT_MAX_ATTEMPTS })

    let lastError: unknown

    for (let attempt = 1; attempt <= INIT_MAX_ATTEMPTS; attempt++) {
      try {
        const weightsPath = join(
          dirname(fileURLToPath(import.meta.url)),
          'models',
          'lr-embedding-weights.json'
        )
        const artifact: LRWeights = JSON.parse(await readFile(weightsPath, 'utf-8'))

        if (!Array.isArray(artifact.weights) || artifact.weights.length !== 1536) {
          throw new Error(
            `Invalid weights: expected 1536 dimensions, got ${artifact.weights?.length ?? 0}`
          )
        }

        this.weights = artifact.weights
        this.bias = artifact.bias
        this.decisionThreshold = decisionThresholdFromMetadata(artifact.metadata)
        this.embeddingModel = await getEmbeddingModel('text-embedding-3-small')
        this.initialized = true

        logger.info('lr_classifier.initialization.complete', {
          attempt,
          durationMs: Date.now() - startTime,
          dimensions: this.weights.length,
          bias: this.bias,
          decisionThreshold: this.decisionThreshold,
          cvAccuracy: artifact.metadata.cvAccuracy,
          f1Fix: artifact.metadata.f1Fix,
          trainedAt: artifact.metadata.trainedAt,
        })
        return
      } catch (error) {
        lastError = error
        this.weights = []
        this.bias = 0
        this.decisionThreshold = DEFAULT_DECISION_THRESHOLD
        this.embeddingModel = null

        logger.error('lr_classifier.initialization.attempt_failed', {
          attempt,
          maxAttempts: INIT_MAX_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.error('lr_classifier.initialization.exhausted', {
      attempts: INIT_MAX_ATTEMPTS,
      durationMs: Date.now() - startTime,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })
    this.initialized = true
  }

  async classify(prompt: string): Promise<ClassificationResult> {
    await this.initialize()

    if (!this.isReady()) {
      logger.warn('lr_classifier.classify.not_ready', {
        reason: 'Weights not loaded, defaulting to general',
      })
      return lrDegradedClassification(prompt)
    }

    const sanitized = prompt.replace(/\s+/g, ' ').trim().substring(0, MAX_PROMPT_LENGTH)
    const hasNegation = NEGATION_PATTERNS.test(prompt)

    logger.info('lr_classifier.classify.start', {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
      hasNegation,
    })

    const startTime = Date.now()

    try {
      const metadata: LitellmMetadata = {
        user: BudgetOverride.AssessAgent,
        tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:lr-classify'],
      }

      const embedding = await llmMetadataContext.run(metadata, async () => {
        const result = await generateEmbeddings(sanitized, this.embeddingModel)
        if (!result.embeddings?.[0]) {
          throw new Error('No embedding returned for prompt')
        }
        return result.embeddings[0].embedding
      })

      const probFix = sigmoid(dot(l2normalize(embedding), this.weights) + this.bias)
      const taskType =
        probFix > this.decisionThreshold ? AssessmentTaskType.Fix : AssessmentTaskType.General
      const confidence = Math.round(Math.max(probFix, 1 - probFix) * 100)
      const requiresHaikuVerification = confidence <= HIGH_CONFIDENCE || hasNegation

      logger.info('lr_classifier.classify.complete', {
        taskType,
        confidence,
        probFix,
        decisionThreshold: this.decisionThreshold,
        hasNegation,
        requiresHaikuVerification,
        durationMs: Date.now() - startTime,
      })

      return {
        taskType,
        confidence,
        similarity: probFix,
        matchedExample: '',
        margin: Math.abs(probFix - this.decisionThreshold) * 2,
        method: 'embedding-lr',
        hasNegation,
        requiresHaikuVerification,
      }
    } catch (error) {
      logger.error('lr_classifier.classify.error', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      })

      return lrDegradedClassification(prompt)
    }
  }

  isReady(): boolean {
    return this.initialized && this.weights.length > 0
  }
}

let lrClassifier: LRClassifier | null = null

export function getLRClassifier(): LRClassifier {
  if (!lrClassifier) {
    lrClassifier = new LRClassifier()
  }
  return lrClassifier
}
