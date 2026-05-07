import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { findLatestAppliedFontTheme } from './findLatestAppliedFontTheme'

describe('findLatestAppliedFontTheme', () => {
  it('returns null for empty messages array', () => {
    expect(findLatestAppliedFontTheme([])).toBeNull()
  })

  it('returns null when no assistant messages exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      },
    ]
    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when no fontTheme tool calls exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Hi',
        toolCalls: [
          {
            id: 'tc1',
            name: 'someOtherTool',
            input: {},
            status: 'completed',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when fontTheme mode is not "apply"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when fontTheme status is not "completed"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'running',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('extracts applied font with full appliedFont object', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'Professional',
              appliedFont: {
                headerFont: {
                  name: 'Roboto',
                  weights: ['400', '700'],
                  category: 'sans-serif',
                },
                bodyFont: {
                  name: 'Open Sans',
                  weights: ['400', '600'],
                  category: 'sans-serif',
                },
              },
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result).toEqual({
      id: 'current-applied',
      name: 'Professional',
      headerFont: {
        name: 'Roboto',
        weights: ['400', '700'],
        category: 'sans-serif',
      },
      bodyFont: {
        name: 'Open Sans',
        weights: ['400', '600'],
        category: 'sans-serif',
      },
    })
  })

  it('falls back to headerFont and bodyFont strings when appliedFont is missing', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'Simple',
              headerFont: 'Playfair Display',
              bodyFont: 'Lato',
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result).toEqual({
      id: 'current-applied',
      name: 'Simple',
      headerFont: {
        name: 'Playfair Display',
        weights: ['400', '700'],
      },
      bodyFont: {
        name: 'Lato',
        weights: ['400', '500'],
      },
    })
  })

  it('defaults weights to [400, 700] for header and [400, 500] for body in fallback path', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              headerFont: 'Arial',
              bodyFont: 'Helvetica',
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.headerFont.weights).toEqual(['400', '700'])
    expect(result?.bodyFont.weights).toEqual(['400', '500'])
  })

  it('defaults weights to [400, 700] for header and [400, 500] for body in appliedFont path', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              appliedFont: {
                headerFont: {
                  name: 'Roboto',
                },
                bodyFont: {
                  name: 'Open Sans',
                },
              },
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.headerFont.weights).toEqual(['400', '700'])
    expect(result?.bodyFont.weights).toEqual(['400', '500'])
  })

  it('defaults themeName to "Current" when missing', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              headerFont: 'Roboto',
              bodyFont: 'Open Sans',
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.name).toBe('Current')
  })

  it('returns latest applied theme when multiple exist', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'Old Theme',
              headerFont: 'Arial',
              bodyFont: 'Helvetica',
            },
          },
        ],
      },
      {
        id: 'msg2',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc2',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'New Theme',
              headerFont: 'Roboto',
              bodyFont: 'Open Sans',
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.name).toBe('New Theme')
  })

  it('returns null when headerFont is missing in both paths', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'Incomplete',
              bodyFont: 'Open Sans',
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when bodyFont is missing in both paths', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              themeName: 'Incomplete',
              headerFont: 'Roboto',
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when appliedFont has only headerFont', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              appliedFont: {
                headerFont: {
                  name: 'Roboto',
                  weights: ['400', '700'],
                },
              },
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when appliedFont has only bodyFont', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              appliedFont: {
                bodyFont: {
                  name: 'Open Sans',
                  weights: ['400'],
                },
              },
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('returns null when result is not an object', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: 'not an object',
          },
        ],
      },
    ]

    expect(findLatestAppliedFontTheme(messages)).toBeNull()
  })

  it('preserves category from appliedFont structure', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              appliedFont: {
                headerFont: {
                  name: 'Playfair Display',
                  weights: ['400'],
                  category: 'serif',
                },
                bodyFont: {
                  name: 'Roboto',
                  weights: ['400'],
                  category: 'sans-serif',
                },
              },
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.headerFont.category).toBe('serif')
    expect(result?.bodyFont.category).toBe('sans-serif')
  })

  it('does not include category in fallback path', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              headerFont: 'Roboto',
              bodyFont: 'Open Sans',
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedFontTheme(messages)
    expect(result?.headerFont).not.toHaveProperty('category')
    expect(result?.bodyFont).not.toHaveProperty('category')
  })
})
