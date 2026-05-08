/**
 * Embedding-based prompt classifier for fast, semantic task classification
 *
 * Uses nearest-neighbor matching against pre-computed example embeddings.
 * Compares user prompt to ALL examples and returns the category of the closest match.
 * Much faster than LLM-based classification (~50-100ms vs 1-2s).
 *
 * IMPORTANT LIMITATIONS:
 * - Embeddings don't handle negation well ("don't publish" ≈ "publish")
 * - Multi-intent prompts match closest single example
 * - Caller should use Haiku fallback for ambiguous cases
 */

import { getEmbeddingModel, generateEmbeddings, cosineSimilarity, type EmbeddingModel } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { BudgetOverride, LlmCallSource } from '@airo/ai-grants'
import { Logger } from '../../logging/index.js'
import { NEGATION_PATTERNS } from './keywords.js'
import { AssessmentTaskType, type ClassificationResult, type IClassifier } from './types.js'

const logger = Logger.create({ component: 'embedding-classifier' })

/** Network call (batch embed examples); transient failures are worth retrying. */
const INIT_MAX_ATTEMPTS = 3

// ============================================================================
// CONFIGURATION
// ============================================================================

// Similarity threshold above which we trust embedding without Haiku verification
const HIGH_CONFIDENCE_SIMILARITY = 0.75

// Minimum confidence score required to trust embedding without Haiku verification
const MIN_CONFIDENCE_FOR_EMBEDDING = 65

/**
 * Maximum prompt length to embed (text-embedding-3-small limit is 8191 tokens)
 * We truncate to ~2000 chars to be safe and fast
 */
const MAX_PROMPT_LENGTH = 2000

/**
 * Canonical examples for each task type.
 *
 * WHY ENGLISH-PRIMARY: Multilingual embedding models (text-embedding-3-small)
 * map semantically similar text to nearby vectors REGARDLESS of language.
 * "publish my app" and "publicar mi aplicación" cluster together naturally.
 *
 * WHY CJK/THAI ADDITIONS: Languages with different scripts and grammatical
 * structures (Chinese, Japanese, Korean, Thai) may have lower cross-lingual
 * similarity. We add minimal examples for these to ensure coverage.
 *
 * WHY NOT ALL LANGUAGES: Adding examples in every language dilutes the
 * embedding space and increases initialization cost without proven benefit.
 * Haiku fallback handles edge cases perfectly.
 */
const CATEGORY_EXAMPLES: Record<AssessmentTaskType, string[]> = {
  [AssessmentTaskType.Domain]:[  // English - primary examples
    'buy a domain',
    'attach a custom domain',
    'connect my domain',
    'add a domain',
    'get a custom URL',
    'purchase a domain name',
    'use my own domain',
    'set up my domain',
    'configure DNS',
    'domain settings',
    'custom domain setup',
    'I want my own domain',
    'attach domain',
    'connect domain',
    // Typo variations
    'domainn',
    'domian',
    'dmain',
    'doman',
    'get a domian',
    // Domain search/availability actions
    'search for domains',
    'check domain availability',
    'is mybusiness.com available',
    'suggest some domains',
    // CJK + Thai - structurally different
    '购买域名',          // Chinese Simplified: buy domain
    '绑定域名',          // Chinese: connect domain
    '購買網域',          // Chinese Traditional: buy domain
    'ドメインを購入',     // Japanese: buy domain
    'ドメイン設定',       // Japanese: domain settings
    '도메인 구매',        // Korean: buy domain
    '도메인 연결',        // Korean: connect domain
    'ซื้อโดเมน',          // Thai: buy domain
],
  [AssessmentTaskType.Publish]:[// English - primary examples (cross-lingual similarity handles Latin scripts)
    'publish my app',
    'publish my site',
    'deploy to production',
    'go live',
    'push to production',
    'launch my website',
    'release my app',
    'make it live',
    'publish this',
    'deploy my site',
    'make my app public',
    'put it online',
    'ship it',
    'make my site public',
    'publish the app',
    'deploy this',
    // "share" and "make live" patterns (common publish intent)
    'share my site',
    'share my website',
    'share this with everyone',
    'make the store live',
    'make my store live',
    // Typo variations
    'publsh my site',
    'pubish my app',
    'pulish this',
    // CJK + Thai - structurally different, may need explicit examples
    '发布我的应用',      // Chinese Simplified: publish my app
    '上线',             // Chinese: go live
    '發佈我的網站',      // Chinese Traditional: publish my site
    'アプリを公開する',   // Japanese: publish my app
    '公開する',          // Japanese: make it public
    '앱 게시',           // Korean: publish app
    '배포하기',          // Korean: deploy
    'เผยแพร่แอป',        // Thai: publish app
  ],
  [AssessmentTaskType.General]: [
  
    'create a website for my bakery',
    'build me an online store',
    'make me a portfolio site',
    'I want a landing page for my business',
    'design a website for my restaurant',
    'build an app for my company',
    'create a blog',
    'make a simple website',
    'build me a site',
    'create a site for my business',
    'make me a website',
    'I need a website',
    'build a website',
    'create my website',

    // Feature requests (common follow-ups)
    'add a contact form',
    'change the colors',
    'add a new page',
    'update the header',
    'add more images',
    'change the font',

    // Questions (should not trigger special tasks)
    'how do I publish my site',
    'what is my domain',
    'how does this work',

    // =========================================================================
    // CONTINUATION PATTERNS (NOT fixes - user resuming interrupted work)
    // =========================================================================
    'continue',
    'keep going',
    'continue building',
    'finish this',
    'finish the site',
    'complete this',
    'complete the page',
    'resume',
    'pick up where you left off',
    'continue from where you stopped',
    'keep working on this',
    'finish what you started',
    'you stopped, continue',

    // =========================================================================
    // INCOMPLETE WORK PATTERNS (NOT fixes)
    // Focus on "missing/empty/unfinished" language that's distinct from fix patterns
    // =========================================================================
    // "Unfinished" - clearly about completion
    'this isnt finished',
    'you didnt finish',
    'the page is incomplete',
    'you left this unfinished',
    'you stopped in the middle',

    // "Missing/empty" - about absence, not malfunction
    'the page is empty',
    'content is missing',
    'the about page is missing',
    'some pages are missing',

    // "Doesn't go anywhere" - destination missing (distinct from "doesn't work")
    'the link doesnt go anywhere',
    'links arent set up yet',

    // CJK + Thai - structurally different
    '为我的面包店创建网站',      // Chinese Simplified: create website for bakery
    '帮我建一个网站',           // Chinese: help me build a website
    '為我的餐廳設計網站',        // Chinese Traditional: design website for my restaurant
    'ウェブサイトを作って',      // Japanese: make a website
    'ポートフォリオを作成',      // Japanese: create portfolio
    '웹사이트 만들어줘',         // Korean: make me a website
    '블로그 만들기',            // Korean: create a blog
    'สร้างเว็บไซต์',           // Thai: create website

    // Continuation patterns - CJK
    '继续',                     // Chinese: continue
    '继续工作',                 // Chinese: keep working
    '完成这个',                 // Chinese: finish this
    '続けて',                   // Japanese: continue
    '계속해',                   // Korean: continue
    'ทำต่อ',                    // Thai: continue
  ],
  [AssessmentTaskType.Fix]: [
    // =========================================================================
    // EXPLICIT FIX REQUESTS
    // =========================================================================
    'fix this',
    'fix it',
    'fix this bug',
    'fix the bug',
    'fix my site',
    'fix my app',
    'fix the issue',
    'fix the problem',
    'fix that',
    'fix please',
    'fix the button',
    'fix the page',
    'fix the form',
    'debug this',
    'help me fix',
    'troubleshoot this',

    // =========================================================================
    // "IS BROKEN" PATTERNS
    // =========================================================================
    'something is broken',
    'its broken',
    'it is broken',
    'this is broken',
    'the site is broken',
    'my site is broken',
    'my website is broken',
    'everything is broken',
    'the button is broken',
    'the menu is broken',
    'broken functionality',
    'broken link',
    'layout is broken',

    // =========================================================================
    // "NOT WORKING" PATTERNS
    // =========================================================================
    'not working',
    'its not working',
    'this is not working',
    'the button doesnt work',
    'button doesnt work',
    'navigation doesnt work',
    'checkout not working',
    'form doesnt submit',
    'the form is not submitting',
    'nothing works',
    'page not loading',
    'image wont load',
    'images not showing up',
    'images wont load',
    'customers cant checkout',

    // =========================================================================
    // ERROR / BUG PATTERNS
    // =========================================================================
    'there is an error',
    'theres an error',
    'i got an error',
    'getting an error',
    'error message',
    'error message appears',
    'javascript error',
    'console error',
    'theres a bug',
    'i found a bug',
    'there is a problem',
    'something went wrong',
    'this is failing',
    'it crashed',
    'the site crashed',
    'it keeps crashing',
    'blank page',
    'having issues',
    'help something is wrong',

    // =========================================================================
    // REGRESSION MARKERS (explicitly states it worked before)
    // =========================================================================
    'it was working before',
    'this was working and now its broken',
    'it broke after the last change',
    'you broke it',
    'since yesterday it stopped working',
    'suddenly stopped working',
    'stopped working',
    'it broke',
    'something broke',
    'something is broken after the update',
    'the form broke',
    'the button broke after your change',

    // =========================================================================
    // TYPO VARIATIONS
    // =========================================================================
    'fixx this',
    'fixx this bug',
    'fxi the bug',
    'fxi the error',
    'its brokn',
    'somethings borken',

    // CJK + Thai - structurally different (with regression/error context)
    '修复这个错误',       // Chinese Simplified: fix this bug/error
    '出错了',            // Chinese: there's an error
    '修復錯誤',          // Chinese Traditional: fix the bug
    'バグを直して',       // Japanese: fix the bug
    'エラーが出た',       // Japanese: an error appeared
    '버그 수정',          // Korean: fix bug
    '오류가 발생했습니다', // Korean: an error occurred
    'แก้ไขบัค',          // Thai: fix bug
  ]
}

// Stored example with its embedding
interface StoredExample {
  text: string
  taskType: AssessmentTaskType
  embedding: number[]
}

export class EmbeddingClassifier implements IClassifier {
  private examples: StoredExample[] = []
  private embeddingModel: EmbeddingModel | null = null
  private initialized = false
  private initializationPromise: Promise<void> | null = null

  /**
   * Initialize the classifier by computing embeddings for all examples
   * This is done lazily on first use, then cached
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = this.doInitialize()
    return this.initializationPromise
  }

  private async doInitialize(): Promise<void> {
    const startTime = Date.now()

    const exampleCounts: Record<string, number> = {}
    for (const [taskType, examples] of Object.entries(CATEGORY_EXAMPLES)) {
      exampleCounts[taskType] = examples.length
    }

    logger.info('embedding_classifier.initialization.start', {
      method: 'nearest-neighbor',
      exampleCounts,
      totalExamples: Object.values(exampleCounts).reduce((a, b) => a + b, 0),
      maxAttempts: INIT_MAX_ATTEMPTS,
    })

    let lastError: unknown

    for (let attempt = 1; attempt <= INIT_MAX_ATTEMPTS; attempt++) {
      try {
        this.embeddingModel = await getEmbeddingModel('text-embedding-3-small')

        const metadata: LitellmMetadata = {
          user: BudgetOverride.AssessAgent,
          tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:embedding-init'],
        }

        const allExamples: { text: string; taskType: AssessmentTaskType }[] = []
        for (const [taskType, examples] of Object.entries(CATEGORY_EXAMPLES)) {
          if (examples.length > 0) {
            for (const text of examples) {
              allExamples.push({ text, taskType: taskType as AssessmentTaskType })
            }
          }
        }

        const texts = allExamples.map((e) => e.text)

        const embeddings = await llmMetadataContext.run(metadata, async () => {
          const result = await generateEmbeddings(texts, this.embeddingModel)
          if (!result.embeddings || result.embeddings.length !== texts.length) {
            throw new Error(
              `Expected ${texts.length} embeddings, got ${result.embeddings?.length || 0}`
            )
          }
          return result.embeddings.map((e, i) => {
            if (!e?.embedding) throw new Error(`No embedding at batch index ${i}`)
            return e.embedding
          })
        })

        this.examples = []
        for (let i = 0; i < allExamples.length; i++) {
          const example = allExamples[i]
          const embedding = embeddings[i]
          if (example && embedding) {
            this.examples.push({ text: example.text, taskType: example.taskType, embedding })
          }
        }

        this.initialized = true

        const categoryCounts: Record<string, number> = {}
        for (const ex of this.examples) {
          categoryCounts[ex.taskType] = (categoryCounts[ex.taskType] || 0) + 1
        }

        logger.info('embedding_classifier.initialization.complete', {
          attempt,
          method: 'nearest-neighbor',
          totalExamples: this.examples.length,
          categoryCounts,
          durationMs: Date.now() - startTime,
        })
        return
      } catch (error) {
        lastError = error
        this.examples = []
        this.embeddingModel = null

        logger.error('embedding_classifier.initialization.attempt_failed', {
          attempt,
          maxAttempts: INIT_MAX_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.error('embedding_classifier.initialization.exhausted', {
      attempts: INIT_MAX_ATTEMPTS,
      durationMs: Date.now() - startTime,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })
    this.initialized = true
  }

  /**
   * Classify a prompt using nearest-neighbor matching
   * Note: For multi-turn context, Haiku tiebreaker handles previous message
   * Embeddings classify current message only for fast path
   */
  async classify(prompt: string): Promise<ClassificationResult> {
    await this.initialize()

    logger.info('embedding_classifier.classify.start', {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
      examplesLoaded: this.examples.length,
      isReady: this.isReady(),
    })

    if (this.examples.length === 0) {
      logger.warn('embedding_classifier.classify.no_examples', {
        reason: 'No examples loaded, defaulting to general',
      })
      return {
        taskType: AssessmentTaskType.General,
        confidence: 100,
        similarity: 0,
        matchedExample: '',
        margin: 0,
        method: 'embedding-nn',
        hasNegation: false,
        requiresHaikuVerification: false,
      }
    }

    const startTime = Date.now()

    // Sanitize and prepare prompt
    const { sanitized, hasNegation } = this.preprocessPrompt(prompt)

    logger.info('embedding_classifier.preprocess.complete', {
      originalLength: prompt.length,
      sanitizedLength: sanitized.length,
      wasTruncated: prompt.length > MAX_PROMPT_LENGTH,
      hasNegation,
      negationPattern: hasNegation ? prompt.match(NEGATION_PATTERNS)?.[0] : null,
    })

    try {
      // Use assessment agent budget
      const metadata: LitellmMetadata = {
        user: BudgetOverride.AssessAgent,
        tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:embedding-classify'],
      }

      const embeddingStartTime = Date.now()
      const promptEmbedding = await llmMetadataContext.run(metadata, async () => {
        const promptResult = await generateEmbeddings(sanitized, this.embeddingModel)
        if (!promptResult.embeddings?.[0]) {
          throw new Error('No embedding returned for prompt')
        }
        return promptResult.embeddings[0].embedding
      })
      const embeddingDurationMs = Date.now() - embeddingStartTime

      logger.info('embedding_classifier.embedding.complete', {
        embeddingDurationMs,
        dimensions: promptEmbedding.length,
      })

      // Calculate similarity to ALL examples
      const comparisonStartTime = Date.now()
      const similarities = this.examples.map((ex) => ({
        taskType: ex.taskType,
        text: ex.text,
        similarity: cosineSimilarity(promptEmbedding, ex.embedding),
      }))
      const comparisonDurationMs = Date.now() - comparisonStartTime

      // Sort by similarity descending
      similarities.sort((a, b) => b.similarity - a.similarity)

      // Log top matches for debugging
      const topMatches = similarities.slice(0, 5).map((s) => ({
        taskType: s.taskType,
        text: s.text,
        similarity: Math.round(s.similarity * 1000) / 1000,
      }))

      logger.info('embedding_classifier.comparison.complete', {
        totalComparisons: this.examples.length,
        comparisonDurationMs,
        topMatches,
      })

      const best = similarities[0]

      // Find best match from a DIFFERENT category (for margin calculation)
      const bestOtherCategory = similarities.find((s) => s.taskType !== best?.taskType)
      const margin = best && bestOtherCategory
        ? best.similarity - bestOtherCategory.similarity
        : best?.similarity || 0

      const durationMs = Date.now() - startTime

      if (!best) {
        logger.warn('embedding_classifier.no_match', {
          reason: 'No similarities calculated',
          durationMs,
        })
        return {
          taskType: AssessmentTaskType.General,
          confidence: 100,
          similarity: 0,
          matchedExample: '',
          margin: 0,
          method: 'embedding-nn',
          hasNegation,
          requiresHaikuVerification: false,
        }
      }

      // Convert similarity to confidence
      // Base formula: similarity 0.85 → 83, 0.95 → 94, 1.0 → 100
      const rawConfidence = Math.min(100, Math.round(best.similarity * 110 - 10))
      let confidence = rawConfidence

      // IMPORTANT: Reduce confidence if negation detected
      // "don't publish" should trigger Haiku verification, not auto-classify
      if (hasNegation && best.taskType !== AssessmentTaskType.General) {
        confidence = Math.min(confidence, 70) // Cap at 70 to trigger Haiku
        logger.info('embedding_classifier.confidence.adjusted_for_negation', {
          rawConfidence,
          adjustedConfidence: confidence,
          taskType: best.taskType,
          matchedExample: best.text,
          negationFound: prompt.match(NEGATION_PATTERNS)?.[0],
        })
      }

      // Final result log with all details
      logger.info('embedding_classifier.classify.complete', {
        // Result
        taskType: best.taskType,
        confidence,
        similarity: best.similarity,
        matchedExample: best.text,
        margin,
        hasNegation,
        // Second best for context
        secondBestCategory: bestOtherCategory?.taskType,
        secondBestExample: bestOtherCategory?.text,
        secondBestSimilarity: bestOtherCategory?.similarity,
        // Timing breakdown
        embeddingDurationMs,
        comparisonDurationMs,
        totalDurationMs: durationMs,
      })

      return {
        taskType: best.taskType,
        confidence,
        similarity: best.similarity,
        matchedExample: best.text,
        margin,
        method: 'embedding-nn',
        hasNegation,
        requiresHaikuVerification: best.similarity < HIGH_CONFIDENCE_SIMILARITY
          || confidence < MIN_CONFIDENCE_FOR_EMBEDDING
          || hasNegation,
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      logger.error('embedding_classifier.classify.error', {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      })

      return {
        taskType: AssessmentTaskType.General,
        confidence: 100,
        similarity: 0,
        matchedExample: '',
        margin: 0,
        method: 'embedding-nn',
        hasNegation: false,
        requiresHaikuVerification: false,
      }
    }
  }

  /**
   * Preprocess prompt: sanitize, truncate, detect negation
   */
  private preprocessPrompt(prompt: string): { sanitized: string; hasNegation: boolean } {
    // Normalize whitespace
    let sanitized = prompt.replace(/\s+/g, ' ').trim()

    // Truncate if too long
    if (sanitized.length > MAX_PROMPT_LENGTH) {
      sanitized = sanitized.substring(0, MAX_PROMPT_LENGTH)
      logger.info('embedding_classifier.prompt_truncated', {
        originalLength: prompt.length,
        truncatedLength: MAX_PROMPT_LENGTH,
      })
    }

    // Detect negation patterns
    const hasNegation = NEGATION_PATTERNS.test(prompt)

    return { sanitized, hasNegation }
  }

  /**
   * Check if the classifier is ready
   */
  isReady(): boolean {
    return this.initialized && this.examples.length > 0
  }
}

// Singleton instance
let embeddingClassifier: EmbeddingClassifier | null = null

export function getEmbeddingClassifier(): EmbeddingClassifier {
  if (!embeddingClassifier) {
    embeddingClassifier = new EmbeddingClassifier()
  }
  return embeddingClassifier
}
