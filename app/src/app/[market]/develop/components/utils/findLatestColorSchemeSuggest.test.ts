import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { findLatestColorSchemeSuggest } from './findLatestColorSchemeSuggest'

describe('findLatestColorSchemeSuggest', () => {
  it('returns null for empty messages array', () => {
    expect(findLatestColorSchemeSuggest([])).toBeNull()
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
    expect(findLatestColorSchemeSuggest(messages)).toBeNull()
  })

  it('returns null when no colorScheme tool calls exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
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
    expect(findLatestColorSchemeSuggest(messages)).toBeNull()
  })

  it('returns null when colorScheme mode is not "suggest"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestColorSchemeSuggest(messages)).toBeNull()
  })

  it('returns null when colorScheme status is not "completed"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'running',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestColorSchemeSuggest(messages)).toBeNull()
  })

  it('extracts palettes from widget.widgetData.palettes structure', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              widget: {
                widgetData: {
                  palettes: [
                    {
                      name: 'Ocean Blue',
                      theme: 'light',
                      palette: {
                        background: '#ffffff',
                        foreground: '#000000',
                        primary: '#0066cc',
                        primaryForeground: '#ffffff',
                        secondary: '#6c757d',
                        secondaryForeground: '#ffffff',
                        accent: '#ff6b6b',
                        accentForeground: '#ffffff',
                        muted: '#f8f9fa',
                        mutedForeground: '#6c757d',
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

    const result = findLatestColorSchemeSuggest(messages)
    expect(result).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      palettes: [
        {
          name: 'Ocean Blue',
          theme: 'light',
          palette: {
            background: '#ffffff',
            foreground: '#000000',
            primary: '#0066cc',
            primaryForeground: '#ffffff',
            secondary: '#6c757d',
            secondaryForeground: '#ffffff',
            accent: '#ff6b6b',
            accentForeground: '#ffffff',
            muted: '#f8f9fa',
            mutedForeground: '#6c757d',
          },
        },
      ],
    })
  })

  it('extracts palettes from direct palettes array structure', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                {
                  name: 'Sunset',
                  palette: {
                    background: '#fff5e6',
                    foreground: '#1a1a1a',
                    primary: '#ff6b35',
                    primaryForeground: '#ffffff',
                    secondary: '#f7931e',
                    secondaryForeground: '#ffffff',
                    accent: '#c44569',
                    accentForeground: '#ffffff',
                    muted: '#ffe8d6',
                    mutedForeground: '#8b4513',
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestColorSchemeSuggest(messages)
    expect(result).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      palettes: [
        {
          name: 'Sunset',
          theme: undefined,
          palette: {
            background: '#fff5e6',
            foreground: '#1a1a1a',
            primary: '#ff6b35',
            primaryForeground: '#ffffff',
            secondary: '#f7931e',
            secondaryForeground: '#ffffff',
            accent: '#c44569',
            accentForeground: '#ffffff',
            muted: '#ffe8d6',
            mutedForeground: '#8b4513',
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
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                {
                  name: 'Old Theme',
                  palette: {
                    background: '#000000',
                    foreground: '#ffffff',
                    primary: '#333333',
                    primaryForeground: '#ffffff',
                    secondary: '#666666',
                    secondaryForeground: '#ffffff',
                    accent: '#999999',
                    accentForeground: '#ffffff',
                    muted: '#cccccc',
                    mutedForeground: '#333333',
                  },
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
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                {
                  name: 'New Theme',
                  palette: {
                    background: '#ffffff',
                    foreground: '#000000',
                    primary: '#0066cc',
                    primaryForeground: '#ffffff',
                    secondary: '#6c757d',
                    secondaryForeground: '#ffffff',
                    accent: '#ff6b6b',
                    accentForeground: '#ffffff',
                    muted: '#f8f9fa',
                    mutedForeground: '#6c757d',
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestColorSchemeSuggest(messages)
    expect(result?.toolCallId).toBe('tc2')
    expect(result?.palettes[0].name).toBe('New Theme')
  })

  it('filters out invalid palette entries', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                { name: 'No Palette' }, // Missing palette
                {
                  name: 'Incomplete',
                  palette: { background: '#fff' }, // Missing foreground
                },
                {
                  name: 'Valid',
                  palette: {
                    background: '#ffffff',
                    foreground: '#000000',
                    primary: '#0066cc',
                    primaryForeground: '#ffffff',
                    secondary: '#6c757d',
                    secondaryForeground: '#ffffff',
                    accent: '#ff6b6b',
                    accentForeground: '#ffffff',
                    muted: '#f8f9fa',
                    mutedForeground: '#6c757d',
                  },
                },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestColorSchemeSuggest(messages)
    expect(result?.palettes).toHaveLength(1)
    expect(result?.palettes[0].name).toBe('Valid')
  })

  it('returns null when all palettes are invalid', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                { name: 'No Palette' },
                { palette: { background: '#fff' } },
              ],
            },
          },
        ],
      },
    ]

    expect(findLatestColorSchemeSuggest(messages)).toBeNull()
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
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {
              palettes: [
                {
                  name: 'Root Theme',
                  palette: {
                    background: '#ffffff',
                    foreground: '#000000',
                    primary: '#0066cc',
                    primaryForeground: '#ffffff',
                    secondary: '#6c757d',
                    secondaryForeground: '#ffffff',
                    accent: '#ff6b6b',
                    accentForeground: '#ffffff',
                    muted: '#f8f9fa',
                    mutedForeground: '#6c757d',
                  },
                },
              ],
              widget: {
                widgetData: {
                  palettes: [
                    {
                      name: 'Widget Theme',
                      palette: {
                        background: '#000000',
                        foreground: '#ffffff',
                        primary: '#ff0000',
                        primaryForeground: '#ffffff',
                        secondary: '#00ff00',
                        secondaryForeground: '#ffffff',
                        accent: '#0000ff',
                        accentForeground: '#ffffff',
                        muted: '#333333',
                        mutedForeground: '#cccccc',
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

    const result = findLatestColorSchemeSuggest(messages)
    expect(result?.palettes).toHaveLength(1)
    expect(result?.palettes[0].name).toBe('Root Theme')
  })
})
