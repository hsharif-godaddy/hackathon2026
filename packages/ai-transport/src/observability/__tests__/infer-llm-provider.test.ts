import { describe, expect, it } from 'vitest'

import { inferProviderFromModelName } from '../infer-llm-provider.js'

describe('inferProviderFromModelName', function suite() {
  it('maps claude models to anthropic (ai-lib MODELS.claude-*)', function claudeAnthropic() {
    expect(inferProviderFromModelName('claude-sonnet-4-6')).toBe('anthropic')
    expect(inferProviderFromModelName('claude-haiku-4-5')).toBe('anthropic')
    expect(inferProviderFromModelName('sonnet')).toBe('anthropic')
  })

  it('maps openai models to openai', function gptOpenai() {
    expect(inferProviderFromModelName('gpt-4o')).toBe('openai')
    expect(inferProviderFromModelName('gpt4o')).toBe('openai')
  })

  it('maps OpenAI-compatible providers (Gemini, GLM) to openai to match runtime routing', function openaiCompatible() {
    expect(inferProviderFromModelName('gemini-3-pro-preview')).toBe('openai')
    expect(inferProviderFromModelName('gemini-3-flash-preview')).toBe('openai')
    expect(inferProviderFromModelName('zai-glm-4.7')).toBe('openai')
  })

  it('defaults unrecognized / empty model ids to openai (matches ai-lib fallback)', function unknownDefault() {
    expect(inferProviderFromModelName('mistral-large')).toBe('openai')
    expect(inferProviderFromModelName('')).toBe('openai')
    expect(inferProviderFromModelName('unknown-model-id')).toBe('openai')
  })
})
