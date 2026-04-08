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
import { AssessmentTaskType } from './types.js'

const logger = Logger.create({ service: 'embedding-classifier' })

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Negation patterns for all supported locales.
 *
 * WHY EXPLICIT PATTERNS: Embeddings handle semantics well across languages,
 * but negation is SYNTACTIC - "publish" and "don't publish" have nearly
 * identical embeddings. This is a known limitation that requires lexical detection.
 *
 * WHY ALL LANGUAGES: Unlike examples (where cross-lingual similarity works),
 * negation words must be explicitly matched per language.
 */
const NEGATION_PATTERNS = new RegExp(
  '(' +
    // English (en-us)
    // Note: "not working", "is not", "not broken" are excluded - they describe problem states, not command negations
    // "it's not" / "its not" / "isn't" use negative lookahead to exclude fix-intent phrases like "its not working"
    // These patterns should only match when negating a problem state ("it's not broken" = general)
    "\\b(don'?t|do not|never|stop|cancel|wait|later|not yet|hold off)\\b" +
    "|(it'?s not|its not|isn'?t)(?! working| loading| saving| submitting| showing| displaying| responding| functioning| connecting)" +
    // Spanish (es-es, es-mx, es-us, es-ar, es-cl, es-co, es-pe, es-ve)
    '|\\b(no quiero|no lo hagas|todavía no|espera|cancelar|más tarde|nunca)\\b' +
    // French (fr-fr, fr-ca, fr-be, fr-ch)
    "|\\b(ne pas|pas encore|annuler|attendre|plus tard|jamais)\\b" +
    // German (de-de, de-at, de-ch)
    '|\\b(nicht|noch nicht|warte|abbrechen|später|niemals)\\b' +
    // Portuguese (pt-br, pt-pt)
    '|\\b(não|ainda não|espere|cancelar|mais tarde|nunca)\\b' +
    // Italian (it-it, it-ch)
    '|\\b(non|non ancora|aspetta|annulla|più tardi|mai)\\b' +
    // Dutch (nl-nl, nl-be)
    '|\\b(niet|nog niet|wacht|annuleren|later|nooit)\\b' +
    // Danish (da-dk)
    '|\\b(ikke|vent|annuller|senere|aldrig)\\b' +
    // Greek (el-gr)
    '|\\b(δεν|όχι|μην|περίμενε|ακύρωση|αργότερα|ποτέ)\\b' +
    // Finnish (fi-fi)
    '|\\b(ei|älä|odota|peruuta|myöhemmin|ei koskaan)\\b' +
    // Hindi (hi-in)
    '|(नहीं|मत|रुको|रद्द|बाद में|कभी नहीं)' +
    // Indonesian (id-id)
    '|\\b(tidak|jangan|tunggu|batal|nanti|tidak pernah)\\b' +
    // Norwegian (nb-no)
    '|\\b(ikke|vent|avbryt|senere|aldri)\\b' +
    // Polish (pl-pl)
    '|\\b(nie|poczekaj|anuluj|później|nigdy)\\b' +
    // Swedish (sv-se)
    '|\\b(inte|vänta|avbryt|senare|aldrig)\\b' +
    // Turkish (tr-tr)
    '|\\b(yapma|hayır|bekle|iptal|sonra|asla)\\b' +
    // Ukrainian (uk-ua)
    '|(не|ні|зачекай|скасувати|пізніше|ніколи)' +
    // Vietnamese (vi-vn)
    '|\\b(không|đừng|chưa|chờ|hủy|sau)\\b' +
    // Japanese (ja-jp) - no word boundaries for Japanese
    '|(しない|やめて|まだ|後で|キャンセル|ないで)' +
    // Korean (ko-kr) - no word boundaries for Korean
    '|(하지마|안|아직|나중에|취소)' +
    // Thai (th-th) - no word boundaries for Thai
    '|(ไม่|อย่า|ยัง|รอ|ยกเลิก|ทีหลัง)' +
    // Chinese Simplified/Traditional (zh-cn, zh-tw, zh-hk, zh-sg)
    '|(不要|别|不|还没|等一下|取消|以后|還沒|等一下)' +
    ')',
  'i'
)

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
  [AssessmentTaskType.Publish]: [
    // English - primary examples (cross-lingual similarity handles Latin scripts)
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
  [AssessmentTaskType.Domain]: [
    // English - primary examples
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
  [AssessmentTaskType.Fix]: [
    // English - primary examples
    'fix this bug',
    'something is broken',
    'not working',
    'there is an error',
    'fix the issue',
    'debug this',
    'it crashed',
    'help me fix',
    'broken functionality',
    'this is failing',
    'troubleshoot this',
    'fix this',
    'fix the button',
    'fix the page',
    'it is broken',
    'something went wrong',
    'there is a problem',
    // Real user patterns - combines fix intent with site/app context
    'fix my site',
    'fix my app',
    'the button is broken',
    'button doesnt work',
    'my site is broken',
    'page not loading',
    // Problem descriptions (users describe issues without saying "fix")
    // Only include clear "something is broken" patterns, not user-initiated changes
    'form doesnt submit',
    'the form is not submitting',
    'images not showing up',
    'images wont load',
    'layout is broken',
    'checkout not working',
    'customers cant checkout',
    'error message appears',
    'getting an error',
    // Typo variations (with context to avoid false positives)
    'fixx this',
    'fxi the bug',
    'its brokn',
    'somethings borken',
    // CJK + Thai - structurally different
    '修复这个错误',       // Chinese Simplified: fix this bug
    '出问题了',          // Chinese: something went wrong
    '修復錯誤',          // Chinese Traditional: fix the bug
    'バグを直して',       // Japanese: fix the bug
    '動かない',          // Japanese: not working
    '버그 수정',          // Korean: fix bug
    '작동 안함',          // Korean: not working
    'แก้ไขบัค',          // Thai: fix bug
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

    // CJK + Thai - structurally different
    '为我的面包店创建网站',      // Chinese Simplified: create website for bakery
    '帮我建一个网站',           // Chinese: help me build a website
    '為我的餐廳設計網站',        // Chinese Traditional: design website for my restaurant
    'ウェブサイトを作って',      // Japanese: make a website
    'ポートフォリオを作成',      // Japanese: create portfolio
    '웹사이트 만들어줘',         // Korean: make me a website
    '블로그 만들기',            // Korean: create a blog
    'สร้างเว็บไซต์',           // Thai: create website
  ],
}

// Stored example with its embedding
interface StoredExample {
  text: string
  taskType: AssessmentTaskType
  embedding: number[]
}

interface ClassificationResult {
  taskType: AssessmentTaskType
  confidence: number
  similarity: number
  matchedExample: string
  margin: number // Difference from best match of different category
  method: 'embedding-nn'
  hasNegation: boolean // True if prompt contains negation words like "don't", "not yet"
}

export class EmbeddingClassifier {
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

    // Count examples per category for logging
    const exampleCounts: Record<string, number> = {}
    for (const [taskType, examples] of Object.entries(CATEGORY_EXAMPLES)) {
      exampleCounts[taskType] = examples.length
    }

    logger.info('embedding_classifier.initialization.start', {
      method: 'nearest-neighbor',
      exampleCounts,
      totalExamples: Object.values(exampleCounts).reduce((a, b) => a + b, 0),
    })

    try {
      // Get embedding model (text-embedding-3-small is fast and cheap)
      const modelStartTime = Date.now()
      this.embeddingModel = await getEmbeddingModel('text-embedding-3-small')
      const modelDurationMs = Date.now() - modelStartTime

      logger.info('embedding_classifier.model.loaded', {
        model: 'text-embedding-3-small',
        durationMs: modelDurationMs,
      })

      // Use assessment agent budget for initialization
      const metadata: LitellmMetadata = {
        user: BudgetOverride.AssessAgent,
        tags: [`source:${LlmCallSource.AgentAssessment}`, 'source:embedding-init'],
      }

      // Collect all examples with their task types
      const allExamples: { text: string; taskType: AssessmentTaskType }[] = []
      for (const [taskType, examples] of Object.entries(CATEGORY_EXAMPLES)) {
        if (examples.length > 0) {
          for (const text of examples) {
            allExamples.push({ text, taskType: taskType as AssessmentTaskType })
          }
        }
      }

      // Batch embed all examples at once (more efficient)
      const texts = allExamples.map((e) => e.text)

      const embeddings = await llmMetadataContext.run(metadata, async () => {
        const result = await generateEmbeddings(texts, this.embeddingModel)
        if (!result.embeddings || result.embeddings.length !== texts.length) {
          throw new Error(`Expected ${texts.length} embeddings, got ${result.embeddings?.length || 0}`)
        }
        return result.embeddings.map((e) => e.embedding)
      })

      // Store examples with their embeddings
      for (let i = 0; i < allExamples.length; i++) {
        const example = allExamples[i]
        const embedding = embeddings[i]
        if (example && embedding) {
          this.examples.push({
            text: example.text,
            taskType: example.taskType,
            embedding,
          })
        }
      }

      this.initialized = true
      const durationMs = Date.now() - startTime

      // Count examples per category
      const categoryCounts: Record<string, number> = {}
      for (const ex of this.examples) {
        categoryCounts[ex.taskType] = (categoryCounts[ex.taskType] || 0) + 1
      }

      logger.info('embedding_classifier.initialization.complete', {
        method: 'nearest-neighbor',
        totalExamples: this.examples.length,
        categoryCounts,
        durationMs,
      })
    } catch (error) {
      logger.error('embedding_classifier.initialization.error', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Mark as initialized to prevent retry loops, will fall back to general
      this.initialized = true
      throw error
    }
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
