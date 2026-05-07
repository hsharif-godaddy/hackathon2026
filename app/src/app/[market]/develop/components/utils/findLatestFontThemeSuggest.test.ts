import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { findLatestFontThemeSuggest } from './findLatestFontThemeSuggest'

describe('findLatestFontThemeSuggest', () => {
  it('returns null for empty messages array', () => {
    expect(findLatestFontThemeSuggest([])).toBeNull()
  })

  it('returns null when no assistant messages exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: '',
        timestamp: new Date(),
      },
    ]
    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('returns null when no fontTheme tool calls exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Hi',
        timestamp: new Date(),
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
    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('returns null when fontTheme mode is not "suggest"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('returns null when fontTheme status is not "completed"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'running',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('extracts themes from widget.widgetData.themes structure', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              widget: {
                widgetData: {
                  themes: [
                    {
                      id: 'theme1',
                      name: 'Professional',
                      description: 'Clean and modern',
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
                  ],
                },
              },
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      themes: [
        {
          id: 'theme1',
          name: 'Professional',
          description: 'Clean and modern',
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
      ],
    })
  })

  it('extracts themes from direct themes array structure', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'theme2',
                  name: 'Elegant',
                  headerFont: {
                    name: 'Playfair Display',
                    weights: ['400', '700'],
                  },
                  bodyFont: {
                    name: 'Lato',
                    weights: ['400', '500'],
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      themes: [
        {
          id: 'theme2',
          name: 'Elegant',
          description: undefined,
          headerFont: {
            name: 'Playfair Display',
            weights: ['400', '700'],
            category: undefined,
          },
          bodyFont: {
            name: 'Lato',
            weights: ['400', '500'],
            category: undefined,
          },
        },
      ],
    })
  })

  it('returns latest suggest when multiple exist', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'old',
                  name: 'Old Theme',
                  headerFont: { name: 'Arial', weights: ['400'] },
                  bodyFont: { name: 'Arial', weights: ['400'] },
                },
              ],
            },
          },
        ],
      },
      {
        id: 'msg2',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc2',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'new',
                  name: 'New Theme',
                  headerFont: { name: 'Roboto', weights: ['400', '700'] },
                  bodyFont: { name: 'Open Sans', weights: ['400'] },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.toolCallId).toBe('tc2')
    expect(result?.themes[0].name).toBe('New Theme')
  })

  it('handles legacy single-font fallback', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'legacy',
                  name: 'Legacy Theme',
                  font: {
                    name: 'Helvetica',
                    weights: ['400', '700'],
                    category: 'sans-serif',
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes[0]).toEqual({
      id: 'legacy',
      name: 'Legacy Theme',
      description: undefined,
      headerFont: {
        name: 'Helvetica',
        weights: ['400', '700'],
        category: 'sans-serif',
      },
      bodyFont: {
        name: 'Helvetica',
        weights: ['400', '700'],
        category: 'sans-serif',
      },
    })
  })

  it('uses legacy font only when headerFont or bodyFont is missing', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'partial',
                  name: 'Partial Legacy',
                  headerFont: {
                    name: 'Roboto',
                    weights: ['700'],
                  },
                  font: {
                    name: 'Fallback',
                    weights: ['400'],
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes[0]).toEqual({
      id: 'partial',
      name: 'Partial Legacy',
      description: undefined,
      headerFont: {
        name: 'Roboto',
        weights: ['700'],
        category: undefined,
      },
      bodyFont: {
        name: 'Fallback',
        weights: ['400'],
        category: undefined,
      },
    })
  })

  it('defaults weights to [400, 700] when missing or empty', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'no-weights',
                  name: 'No Weights',
                  headerFont: {
                    name: 'Roboto',
                  },
                  bodyFont: {
                    name: 'Open Sans',
                    weights: [],
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes[0].headerFont.weights).toEqual(['400', '700'])
    expect(result?.themes[0].bodyFont.weights).toEqual(['400', '700'])
  })

  it('filters out non-string weights', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'mixed-weights',
                  name: 'Mixed Weights',
                  headerFont: {
                    name: 'Roboto',
                    weights: ['400', 700, null, '700', undefined],
                  },
                  bodyFont: {
                    name: 'Open Sans',
                    weights: ['400'],
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes[0].headerFont.weights).toEqual(['400', '700'])
  })

  it('filters out invalid theme entries', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                { name: 'No ID' }, // Missing id
                {
                  id: 'no-name',
                  headerFont: { name: 'Roboto', weights: ['400'] },
                  bodyFont: { name: 'Open Sans', weights: ['400'] },
                }, // Missing name
                {
                  id: 'no-fonts',
                  name: 'No Fonts',
                }, // Missing fonts
                {
                  id: 'valid',
                  name: 'Valid Theme',
                  headerFont: { name: 'Roboto', weights: ['400'] },
                  bodyFont: { name: 'Open Sans', weights: ['400'] },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes).toHaveLength(1)
    expect(result?.themes[0].name).toBe('Valid Theme')
  })

  it('returns null when all themes are invalid', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                { name: 'No ID' },
                { id: 'incomplete', name: 'Incomplete' },
              ],
            },
          },
        ],
      },
    ]

    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('prioritizes fromRoot over fromWidget when both exist', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [
                {
                  id: 'root',
                  name: 'Root Theme',
                  headerFont: { name: 'Roboto', weights: ['400'] },
                  bodyFont: { name: 'Open Sans', weights: ['400'] },
                },
              ],
              widget: {
                widgetData: {
                  themes: [
                    {
                      id: 'widget',
                      name: 'Widget Theme',
                      headerFont: { name: 'Arial', weights: ['400'] },
                      bodyFont: { name: 'Helvetica', weights: ['400'] },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    ]

    const result = findLatestFontThemeSuggest(messages)
    expect(result?.themes).toHaveLength(1)
    expect(result?.themes[0].name).toBe('Root Theme')
  })

  it('returns null when result.themes is empty array', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              themes: [],
            },
          },
        ],
      },
    ]

    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })

  it('returns null when result is not an object', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'fontTheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: 'not an object',
          },
        ],
      },
    ]

    expect(findLatestFontThemeSuggest(messages)).toBeNull()
  })
})
