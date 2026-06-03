import { getModel } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { generateText } from 'ai'

import { Logger, log } from '../logging/index.js'

const logger = Logger.create({ component: 'domain-seed-suggestion' })

const MAX_SEEDS = 4
const MAX_SEED_LENGTH = 24
const MIN_SEED_LENGTH = 3

const SYSTEM_PROMPT = `You are a domain name expert. Convert a business description into 4 DIFFERENT brandable domain seeds, each covering a distinct angle:

  1. Core concept
  2. Target market
  3. Key benefit
  4. Industry focus

Rules:
  - Each seed: up to 24 chars, lowercase, no spaces, no punctuation.
  - Brandable and memorable; avoid generic words like "business", "company", "service".
  - Compound words and creative combinations welcome.

Output format: exactly 4 lines, no preamble, no numbering, no commentary. Just one seed per line.`

function parseSeeds(raw: string): string[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const seeds: string[] = []
  for (const line of lines) {
    let cleaned = line
      .replace(/^line\s*\d+\s*[:.-]\s*/i, '')
      .replace(/^\d+\s*[.)-]\s*/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/:\s*$/, '')
      .trim()
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1)
    }
    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      cleaned = cleaned.slice(1, -1)
    }
    // Reject prose: a real seed has no internal whitespace at this point.
    // The prompt asks for "no spaces" — whitespace = LLM emitted preamble or commentary.
    if (/\s/.test(cleaned)) continue
    cleaned = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_SEED_LENGTH)
    if (cleaned.length >= MIN_SEED_LENGTH) {
      seeds.push(cleaned)
      if (seeds.length === MAX_SEEDS) break
    }
  }
  return seeds
}

function buildMetadata(
  executionContext: ExecutionContext | Record<string, unknown> | undefined,
  agentId: string | undefined,
  additionalTags: string[]
): LitellmMetadata {
  if (executionContext) {
    const base = buildLitellmMetadataFromContext(executionContext, {
      source: LlmCallSource.ServiceDomainSeedSuggestion,
      agentId,
    })
    if (base) {
      return { ...base, tags: [...new Set([...(base.tags || []), ...additionalTags])] }
    }
  }
  const existing = llmMetadataContext.getStore()
  const userIdentifier = existing?.user || 'airo-builder:domain-seed-suggestion'
  const baseTags = agentId ? [...additionalTags, `agent:${agentId}`] : [...additionalTags]
  return {
    ...(userIdentifier && { user: userIdentifier }),
    tags: [...new Set([...(existing?.tags || []), ...baseTags])],
  }
}

export class DomainSeedSuggestionService {
  /**
   * Generate up to 4 brandable domain seeds for a business description.
   * Returns [] when the LLM produces no valid seeds, null when the call fails.
   */
  async suggestDomainSeeds(
    prompt: string,
    executionContext?: ExecutionContext | Record<string, unknown>
  ): Promise<string[] | null> {
    try {
      if (!prompt || prompt.trim().length === 0) {
        logger.warn('domains.seeds.suggest.empty-prompt', {})
        return null
      }

      const trimmed = prompt.trim()
      const startedAt = Date.now()
      logger.info('domains.seeds.suggest.begin', { promptLength: trimmed.length })

      const model = await getModel('haiku')

      const typedContext = executionContext as ExecutionContext | undefined
      const agentId = typedContext?.metadata?.agentId
      const additionalTags = ['source:tool-llm', 'source:domain-seed-suggestion']
      const metadata = buildMetadata(executionContext, agentId, additionalTags)

      const generateFn = async () => generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: `Generate seeds for: ${trimmed}`,
        temperature: 0.7,
        maxOutputTokens: 80,
        experimental_telemetry: { isEnabled: true, functionId: 'domain-seed-suggestion' },
      })

      const result = await llmMetadataContext.run(metadata, generateFn)
      const seeds = parseSeeds(result.text || '')

      if (seeds.length === 0) {
        logger.warn('domains.seeds.suggest.empty-content', {
          promptLength: trimmed.length,
          rawLength: (result.text || '').length,
        })
        return []
      }

      logger.info('domains.seeds.suggest.success', {
        seedsCount: seeds.length,
        seedsLength: seeds.map(s => s.length),
        durationMs: Date.now() - startedAt,
      })
      return seeds
    } catch (error) {
      log.error(logger, 'domains.seeds.suggest.error', error as Error, {})
      return null
    }
  }
}

const domainSeedSuggestionService = new DomainSeedSuggestionService()

export function getDomainSeedSuggestionService(): DomainSeedSuggestionService {
  return domainSeedSuggestionService
}
