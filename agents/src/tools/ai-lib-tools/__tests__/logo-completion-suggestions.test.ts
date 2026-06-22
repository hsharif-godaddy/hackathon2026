import { describe, it, expect } from 'vitest'
import { logoCompletionSuggestionsAITool } from '../logo-completion-suggestions.js'

const makeExecutionOptions = (isEmbedded?: boolean): object => ({
  experimental_context: {
    metadata: {
      ...(isEmbedded !== undefined && { isEmbedded }),
    },
  },
})

const execute = (input: { excludeSetAsLogo?: boolean }, isEmbedded?: boolean): Promise<unknown> =>
  logoCompletionSuggestionsAITool.execute!(input, makeExecutionOptions(isEmbedded) as never)

describe('logoCompletionSuggestions tool', () => {
  it('excludes "Set as my logo" when not embedded', async () => {
    const result = await execute({}, false) as { suggestions: { text: string }[] }
    const texts = result.suggestions.map(s => s.text)
    expect(texts).not.toContain('Set as my logo')
    expect(texts).toContain('Edit or refine this logo')
    expect(texts).toContain('Try a different logo style')
    expect(texts).toContain('Build a website with this logo')
  })

  it('excludes "Set as my logo" when isEmbedded is absent from metadata', async () => {
    const result = await execute({}) as { suggestions: { text: string }[] }
    const texts = result.suggestions.map(s => s.text)
    expect(texts).not.toContain('Set as my logo')
  })

  it('includes "Set as my logo" when embedded', async () => {
    const result = await execute({}, true) as { suggestions: { text: string }[] }
    const texts = result.suggestions.map(s => s.text)
    expect(texts).toContain('Set as my logo')
    expect(texts).toContain('Edit or refine this logo')
  })

  it('excludes "Set as my logo" when embedded but excludeSetAsLogo is true', async () => {
    const result = await execute({ excludeSetAsLogo: true }, true) as { suggestions: { text: string }[] }
    const texts = result.suggestions.map(s => s.text)
    expect(texts).not.toContain('Set as my logo')
  })

  it('includes "Set as my logo" when embedded and excludeSetAsLogo is false', async () => {
    const result = await execute({ excludeSetAsLogo: false }, true) as { suggestions: { text: string }[] }
    const texts = result.suggestions.map(s => s.text)
    expect(texts).toContain('Set as my logo')
  })

  it('returns success: true', async () => {
    const result = await execute({}, true) as { success: boolean }
    expect(result.success).toBe(true)
  })
})
