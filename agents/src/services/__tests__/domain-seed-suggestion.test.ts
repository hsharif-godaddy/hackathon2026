import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerateText, mockGetModel, mockBuildLitellmMetadataFromContext, mockLlmMetadataContextRun } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGetModel: vi.fn(),
  mockBuildLitellmMetadataFromContext: vi.fn(),
  mockLlmMetadataContextRun: vi.fn(async (_meta: unknown, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('ai', () => ({ generateText: mockGenerateText }))
vi.mock('@airo/ai-lib', () => ({ getModel: mockGetModel }))
vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: {
    run: mockLlmMetadataContextRun,
    getStore: () => undefined,
  },
}))
vi.mock('@airo/ai-grants', () => ({
  buildLitellmMetadataFromContext: mockBuildLitellmMetadataFromContext,
  LlmCallSource: { ServiceDomainSeedSuggestion: 'service:domain-seed-suggestion' },
}))

import { DomainSeedSuggestionService } from '../domain-seed-suggestion.js'

describe('DomainSeedSuggestionService.suggestDomainSeeds', () => {
  let service: DomainSeedSuggestionService

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetModel.mockResolvedValue({ id: 'mock-haiku' })
    mockBuildLitellmMetadataFromContext.mockReturnValue({ user: 'u', tags: [] })
    service = new DomainSeedSuggestionService()
  })

  it('returns null on empty prompt', async () => {
    const result = await service.suggestDomainSeeds('')
    expect(result).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('returns null on whitespace-only prompt', async () => {
    const result = await service.suggestDomainSeeds('   \n  ')
    expect(result).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('parses 4 clean seeds from a well-formatted response', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'sandbaggerlounge\nsteakhousenearme\nmeatandwhiskey\nchophousebar',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey', 'chophousebar'])
  })

  it('strips ordinals, line prefixes, quotes, and brackets', async () => {
    mockGenerateText.mockResolvedValue({
      text: '1. sandbaggerlounge\n2) "steakhousenearme"\nLine 3: [meatandwhiskey]\n4. \'chophousebar\'',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey', 'chophousebar'])
  })

  it('lowercases and strips non-alphanumerics from non-prose lines', async () => {
    // Lines with internal whitespace are now treated as prose and dropped
    // (covered separately by "drops preamble lines that contain internal whitespace").
    mockGenerateText.mockResolvedValue({
      text: 'My-Brand!\nQ&Awebsite\nGood-Eats-Now\nbrandable',
    })
    const result = await service.suggestDomainSeeds('My Brand description here')
    expect(result).toEqual(['mybrand', 'qawebsite', 'goodeatsnow', 'brandable'])
  })

  it('caps each seed at 24 characters', async () => {
    const long = 'a'.repeat(40)
    mockGenerateText.mockResolvedValue({ text: `${long}\n${long}b\nshortone\nfoobar` })
    const result = await service.suggestDomainSeeds('multi word prompt for caps')
    expect(result![0]).toHaveLength(24)
    expect(result![1]).toHaveLength(24)
    expect(result![2]).toBe('shortone')
  })

  it('drops seeds shorter than 3 chars', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ab\nlongerseed\nx\ngoodone' })
    const result = await service.suggestDomainSeeds('multi word prompt drop short')
    expect(result).toEqual(['longerseed', 'goodone'])
  })

  it('takes only the first 4 seeds when more are returned', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'oneone\ntwotwo\nthreethree\nfourfour\nfivefive\nsixsix',
    })
    const result = await service.suggestDomainSeeds('multi word prompt many seeds')
    expect(result).toHaveLength(4)
    expect(result).toEqual(['oneone', 'twotwo', 'threethree', 'fourfour'])
  })

  it('returns empty array when output yields no valid seeds', async () => {
    mockGenerateText.mockResolvedValue({ text: 'a\n!\n!!\n' })
    const result = await service.suggestDomainSeeds('multi word prompt no seeds')
    expect(result).toEqual([])
  })

  it('returns null when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('LLM down'))
    const result = await service.suggestDomainSeeds('multi word prompt llm down')
    expect(result).toBeNull()
  })

  it('passes executionContext-derived metadata to llmMetadataContext', async () => {
    mockGenerateText.mockResolvedValue({ text: 'aaa\nbbb\nccc\nddd' })
    const ctx = { metadata: { agentId: 'develop' } }
    await service.suggestDomainSeeds('multi word with context', ctx as never)
    expect(mockBuildLitellmMetadataFromContext).toHaveBeenCalledWith(ctx, expect.objectContaining({
      source: 'service:domain-seed-suggestion',
      agentId: 'develop',
    }))
    expect(mockLlmMetadataContextRun).toHaveBeenCalled()
  })

  it('strips markdown bullets from seed lines', async () => {
    mockGenerateText.mockResolvedValue({
      text: '- sandbaggerlounge\n* steakhousenearme\n• meatandwhiskey\n- chophousebar',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey', 'chophousebar'])
  })

  it('strips trailing parenthetical commentary', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'sandbaggerlounge (core concept)\nsteakhousenearme (target market)\nmeatandwhiskey (key benefit)\nchophousebar (industry focus)',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey', 'chophousebar'])
  })

  it('drops preamble lines that contain internal whitespace', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Here are 4 brandable seeds:\nsandbaggerlounge\nsteakhousenearme\nmeatandwhiskey\nchophousebar',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey', 'chophousebar'])
  })

  it('drops trailing prose with internal whitespace', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'sandbaggerlounge\nsteakhousenearme\nmeatandwhiskey\nLet me know if you want more!',
    })
    const result = await service.suggestDomainSeeds('Sandbagger Steakhouse Lounge')
    expect(result).toEqual(['sandbaggerlounge', 'steakhousenearme', 'meatandwhiskey'])
  })
})
