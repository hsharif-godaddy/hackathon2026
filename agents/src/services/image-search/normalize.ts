import { getModel } from '@airo/ai-lib'
import { llmMetadataContext } from '@airo/ai-common'
import { generateObject } from 'ai'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'image-search-normalize' })

const queryIntentSchema = z.object({
  phrases: z.array(z.string()).describe('Multi-word visual concepts (max 2)'),
  terms: z.array(z.string()).describe('Single-word visual terms (max 8)'),
})

export type MediaQueryIntent = z.infer<typeof queryIntentSchema>

const SYSTEM_PROMPT = `Extract visual search terms from the prompt for stock photo search.

Output JSON with:
- phrases: multi-word concepts (max 2), e.g. ["new york", "sushi restaurant"]
- terms: single words (max 8), e.g. ["warm", "modern"]

Rules:
- Keep multi-word concepts together as phrases
- Remove non-visual words: "hero", "image", "photo", "background", "for", "a", "the", "of", etc.
- Lowercase everything
- Always output search terms in English regardless of input language

Examples:
- "hero image for sushi restaurant" → { "phrases": ["sushi restaurant"], "terms": [] }
- "warm cozy coffee shop in new york" → { "phrases": ["coffee shop", "new york"], "terms": ["cozy", "warm"] }
- "modern minimal tech startup" → { "phrases": ["tech startup"], "terms": ["minimal", "modern"] }
- "professional team portrait" → { "phrases": [], "terms": ["professional", "team"] }
- "una foto de un perro y un gato sentados bajo la lluvia en Nueva York" → { "phrases": ["new york"], "terms": ["dog", "cat", "rain"] }
- "写真 東京の夜景" → { "phrases": ["tokyo skyline"], "terms": ["night"] }`

/** Post-process LLM output to enforce constraints. */
export function enforceRules(raw: MediaQueryIntent): MediaQueryIntent {
  const phrases = [...new Set(raw.phrases.map(p => p.toLowerCase().trim()))]
    .filter(p => p.length > 0)
    .slice(0, 2)

  const terms = [...new Set(raw.terms.map(t => t.toLowerCase().trim()))]
    .filter(t => t.length > 0)
    .slice(0, 8)

  return { phrases, terms }
}

/** Build a comma-separated query string from structured intent. */
export function buildQueryString(intent: MediaQueryIntent): string {
  return [...intent.phrases, ...intent.terms].join(', ')
}

/**
 * Normalizes a user's search query into concise Getty-friendly search terms
 * using structured output from GPT-4o-mini.
 *
 * "a hero image of a sunset over mountains" → "sunset, mountains, landscape"
 * "warm cozy coffee shop in new york" → "coffee shop, new york, cozy, warm"
 *
 * Always returns a usable string — falls back to the original query on any error.
 */
export async function normalizeSearchQuery(rawQuery: string): Promise<string> {
  const trimmed = rawQuery.trim()
  if (!trimmed) return trimmed

  // Short queries (≤ 3 words) are already concise enough
  const wordCount = trimmed.split(/\s+/).length
  if (wordCount <= 3) return trimmed

  try {
    const model = await getModel('gpt4o-mini')

    const metadata = {
      user: 'airo-builder:image-search-normalize',
      tags: ['source:tool-llm', 'source:image-search-normalize'],
    }

    const generateFn = async () => {
      return await generateObject({
        model,
        schema: queryIntentSchema,
        schemaName: 'query_intent',
        system: SYSTEM_PROMPT,
        prompt: trimmed,
        maxOutputTokens: 100,
        experimental_telemetry: { isEnabled: true, functionId: 'image-search-normalize' },
      })
    }

    const result = await llmMetadataContext.run(metadata, generateFn)
    const intent = enforceRules(result.object)
    const queryString = buildQueryString(intent)

    if (!queryString) {
      logger.warn('image-search.normalize.empty_result', { rawQuery: trimmed })
      return trimmed
    }

    logger.info('image-search.normalize.success', { rawQuery: trimmed, normalized: queryString, intent })
    return queryString
  } catch (error) {
    logger.warn('image-search.normalize.error', {
      rawQuery: trimmed,
      error: error instanceof Error ? error.message : String(error),
    })
    // Fall back to original query on any error
    return trimmed
  }
}
