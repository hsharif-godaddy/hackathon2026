import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ai-lib and ai SDK before imports
vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn().mockResolvedValue({ modelId: 'gpt-4o-mini' }),
}))

vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { run: vi.fn((_meta: unknown, fn: () => unknown) => fn()) },
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { generateObject } from 'ai'
import { normalizeSearchQuery, enforceRules, buildQueryString } from '../normalize.js'

const mockGenerateObject = vi.mocked(generateObject)

describe('normalizeSearchQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty string for empty input', async () => {
    expect(await normalizeSearchQuery('')).toBe('')
    expect(await normalizeSearchQuery('  ')).toBe('')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('returns short queries unchanged (≤ 3 words)', async () => {
    expect(await normalizeSearchQuery('sunset mountains')).toBe('sunset mountains')
    expect(await normalizeSearchQuery('blue sky clouds')).toBe('blue sky clouds')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('normalizes longer queries via LLM structured output', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { phrases: ['sushi restaurant'], terms: [] },
    } as never)

    const result = await normalizeSearchQuery('a hero image for a sushi restaurant')
    expect(result).toBe('sushi restaurant')
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })

  it('combines phrases and terms into query string', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { phrases: ['coffee shop', 'new york'], terms: ['cozy', 'warm'] },
    } as never)

    const result = await normalizeSearchQuery('warm cozy coffee shop in new york')
    expect(result).toBe('coffee shop, new york, cozy, warm')
  })

  it('falls back to original query when LLM returns empty arrays', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { phrases: [], terms: [] },
    } as never)

    const result = await normalizeSearchQuery('something techy for my landing page')
    expect(result).toBe('something techy for my landing page')
  })

  it('falls back to original query on LLM error', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('API timeout'))

    const result = await normalizeSearchQuery('a beautiful hero image of nature')
    expect(result).toBe('a beautiful hero image of nature')
  })

  it('uses gpt4o-mini model', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { phrases: ['tech startup'], terms: ['modern'] },
    } as never)

    await normalizeSearchQuery('modern minimal tech startup landing page')

    const { getModel } = await import('@airo/ai-lib')
    expect(getModel).toHaveBeenCalledWith('gpt4o-mini')
  })
})

describe('enforceRules', () => {
  it('lowercases and deduplicates phrases and terms', () => {
    const result = enforceRules({
      phrases: ['Coffee Shop', 'coffee shop', 'New York'],
      terms: ['Warm', 'cozy', 'warm'],
    })
    // "Coffee Shop" and "coffee shop" collapse to one after lowercasing + Set dedup
    expect(result.phrases).toEqual(['coffee shop', 'new york'])
    // "Warm" and "warm" collapse to one
    expect(result.terms).toEqual(['warm', 'cozy'])
  })

  it('caps phrases at 2 and terms at 8', () => {
    const result = enforceRules({
      phrases: ['a b', 'c d', 'e f'],
      terms: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    })
    expect(result.phrases).toHaveLength(2)
    expect(result.terms).toHaveLength(8)
  })

  it('filters empty strings', () => {
    const result = enforceRules({
      phrases: ['', '  ', 'valid phrase'],
      terms: ['', 'good'],
    })
    expect(result.phrases).toEqual(['valid phrase'])
    expect(result.terms).toEqual(['good'])
  })
})

describe('buildQueryString', () => {
  it('joins phrases and terms with comma separator', () => {
    expect(buildQueryString({ phrases: ['coffee shop'], terms: ['warm', 'cozy'] }))
      .toBe('coffee shop, warm, cozy')
  })

  it('returns empty string for empty intent', () => {
    expect(buildQueryString({ phrases: [], terms: [] })).toBe('')
  })
})
