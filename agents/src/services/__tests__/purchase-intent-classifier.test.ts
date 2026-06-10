import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'
import {
  classifyPurchaseIntent,
  TIGHT_PATTERNS,
  LOOSE_PATTERN,
} from '../purchase-intent-classifier.js'

const makeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})

const mockedGetModel = vi.mocked(getModel)
const mockedGenerateText = vi.mocked(generateText)

describe('classifyPurchaseIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetModel.mockResolvedValue({} as any)
  })

  describe('Phase 1a — tight regex (no LLM)', () => {
    const tightHits = [
      'Upgrade plan and publish the site',
      'Upgrade my plan so I can publish',
      'Upgrade to Airo Plus plan to publish the site',
      'enable publishing',
      'Upgrade my plan to enable publishing',
      "I'd like to purchase the domain neural-path.com",
      'Buy a custom domain',
      'buy a custom domain',
    ]

    for (const input of tightHits) {
      it(`returns true for tight match: "${input}"`, async () => {
        const logger = makeLogger()
        const result = await classifyPurchaseIntent(input, { logger })

        expect(result).toBe(true)
        expect(mockedGenerateText).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
          'purchase_intent.classified',
          expect.objectContaining({ result: true, method: 'tight_regex' }),
        )
      })
    }
  })

  describe('Phase 1b — loose regex miss (no LLM)', () => {
    const looseMisses = [
      'change the button color',
      'add a testimonials section',
      'fix the mobile layout',
      '',
      'modify the avatar',
    ]

    for (const input of looseMisses) {
      it(`returns false for loose miss: "${input}"`, async () => {
        const logger = makeLogger()
        const result = await classifyPurchaseIntent(input, { logger })

        expect(result).toBe(false)
        expect(mockedGenerateText).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
          'purchase_intent.classified',
          expect.objectContaining({ result: false, method: 'loose_regex_miss' }),
        )
      })
    }
  })

  describe('Phase 2 — Haiku LLM', () => {
    const ambiguousInput = 'Help me plan the structure and pages for my app'

    it('returns true when Haiku replies "yes"', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'yes' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(true)
      expect(mockedGenerateText).toHaveBeenCalledTimes(1)
      expect(logger.info).toHaveBeenCalledWith(
        'purchase_intent.classified',
        expect.objectContaining({ result: true, method: 'haiku' }),
      )
    })

    it('tolerates "Yes." with punctuation', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'Yes.' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(true)
    })

    it('tolerates "YES\\n" with whitespace', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'YES\n' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(true)
    })

    it('returns false on "no"', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'no' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(false)
    })

    it('fail-closed on empty text', async () => {
      mockedGenerateText.mockResolvedValue({ text: '' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(false)
    })

    it('fail-closed on unexpected text', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'I cannot determine' } as any)
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(false)
    })

    it('fail-closed and warns on generateText error', async () => {
      mockedGenerateText.mockRejectedValue(new Error('upstream_500'))
      const logger = makeLogger()

      const result = await classifyPurchaseIntent(ambiguousInput, { logger })

      expect(result).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        'purchase_intent.classifier_error',
        expect.objectContaining({ error: 'upstream_500' }),
      )
    })

    it('fail-closed and warns on timeout', async () => {
      vi.useFakeTimers()
      mockedGenerateText.mockImplementation(
        () => new Promise(() => undefined) as any,
      )
      const logger = makeLogger()

      const promise = classifyPurchaseIntent(ambiguousInput, { logger })
      await vi.advanceTimersByTimeAsync(1500)
      const result = await promise

      expect(result).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        'purchase_intent.classifier_timeout',
        expect.objectContaining({ timeoutMs: 1500 }),
      )
      vi.useRealTimers()
    })

    it('passes cacheControl: ephemeral on the system message', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'no' } as any)
      const logger = makeLogger()

      await classifyPurchaseIntent(ambiguousInput, { logger })

      const call = mockedGenerateText.mock.calls[0]?.[0]
      const systemMessage = (call as any).messages.find(
        (m: any) => m.role === 'system',
      )
      expect(systemMessage.providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      })
    })

    it('routes a Phase-1b match to the LLM', async () => {
      mockedGenerateText.mockResolvedValue({ text: 'no' } as any)
      const logger = makeLogger()

      const ambiguous = 'Add a live chat widget or chatbot'
      await classifyPurchaseIntent(ambiguous, { logger })

      expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    })
  })

  describe('exported regex constants', () => {
    it('TIGHT_PATTERNS contains 4 entries matching the spec', () => {
      expect(TIGHT_PATTERNS).toHaveLength(4)
    })

    it('LOOSE_PATTERN matches the case-insensitive keyword set', () => {
      expect(LOOSE_PATTERN.test('Connect a custom domain')).toBe(true)
      expect(LOOSE_PATTERN.test('change the button color')).toBe(false)
    })
  })
})
