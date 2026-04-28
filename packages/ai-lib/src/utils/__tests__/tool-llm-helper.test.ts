import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateTextWithTracking } from '../tool-llm-helper.js'

const mockGenerateText = vi.hoisted(() => vi.fn())

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: mockGenerateText,
  }
})

describe('tool-llm-helper', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockGenerateText.mockResolvedValue({
      text: 'generated',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      finishReason: 'stop',
    })
  })

  describe('#generateTextWithTracking', () => {
    it('does not duplicate model default provider options', async function defaults() {
      await generateTextWithTracking({
        model: { modelId: 'claude-sonnet-4-6' } as any,
        modelName: 'sonnet',
        prompt: 'Generate something',
      })

      expect(mockGenerateText.mock.calls[0][0].providerOptions).toBeUndefined()
    })

    it('passes explicit provider options through to generateText', async function override() {
      await generateTextWithTracking({
        model: { modelId: 'claude-sonnet-4-6' } as any,
        modelName: 'sonnet',
        prompt: 'Generate something',
        providerOptions: {
          anthropic: { effort: 'medium' },
        },
      })

      expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
        providerOptions: {
          anthropic: { effort: 'medium' },
        },
      }))
    })
  })
})
