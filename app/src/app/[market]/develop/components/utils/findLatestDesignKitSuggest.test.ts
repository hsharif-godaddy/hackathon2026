import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { findLatestDesignKitSuggest } from './findLatestDesignKitSuggest'

describe('findLatestDesignKitSuggest', () => {
  it('returns null for empty messages array', () => {
    expect(findLatestDesignKitSuggest([])).toBeNull()
  })

  it('returns null when no assistant messages exist', () => {
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content: '', timestamp: new Date() }]
    expect(findLatestDesignKitSuggest(messages)).toBeNull()
  })

  it('returns null when no suggestDesignKits tool calls exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Hi',
        toolCalls: [{ id: 'tc1', name: 'someOtherTool', input: {}, status: 'completed', result: {} }],
      },
    ]
    expect(findLatestDesignKitSuggest(messages)).toBeNull()
  })

  it('returns null when suggestDesignKits status is not "completed"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: { slugs: ['bold-studio'] },
            status: 'running',
            result: { kits: [{ slug: 'bold-studio', displayName: 'Bold Studio' }] },
          },
        ],
      },
    ]
    expect(findLatestDesignKitSuggest(messages)).toBeNull()
  })

  it('extracts kit options from the tool result', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: { slugs: ['bold-studio'] },
            status: 'completed',
            result: {
              success: true,
              kits: [
                {
                  slug: 'bold-studio',
                  displayName: 'Bold Studio',
                  thumbnailUrl: 'https://cdn.example/bold.webp',
                  tags: ['bold', 'modern'],
                  palette: { primary: '#111', background: '#fff', foreground: '#000', accent: '#f00', muted: '#eee' },
                  displayFont: 'Inter',
                },
              ],
            },
          },
        ],
      },
    ]

    expect(findLatestDesignKitSuggest(messages)).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      kits: [
        {
          slug: 'bold-studio',
          displayName: 'Bold Studio',
          thumbnailUrl: 'https://cdn.example/bold.webp',
          tags: ['bold', 'modern'],
          palette: { primary: '#111', background: '#fff', foreground: '#000', accent: '#f00', muted: '#eee' },
          displayFont: 'Inter',
        },
      ],
    })
  })

  it('defaults missing optional fields (thumbnailUrl, tags, palette colors, displayFont)', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: {},
            status: 'completed',
            result: { kits: [{ slug: 'minimal', displayName: 'Minimal' }] },
          },
        ],
      },
    ]

    expect(findLatestDesignKitSuggest(messages)).toEqual({
      toolCallId: 'tc1',
      messageId: 'msg1',
      kits: [
        {
          slug: 'minimal',
          displayName: 'Minimal',
          thumbnailUrl: null,
          tags: [],
          palette: {
            primary: undefined,
            background: undefined,
            foreground: undefined,
            accent: undefined,
            muted: undefined,
          },
          displayFont: null,
        },
      ],
    })
  })

  it('filters out kit entries missing slug or displayName', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: {},
            status: 'completed',
            result: {
              kits: [
                { displayName: 'No Slug' },
                { slug: 'no-name' },
                { slug: 'valid', displayName: 'Valid' },
              ],
            },
          },
        ],
      },
    ]

    const result = findLatestDesignKitSuggest(messages)
    expect(result?.kits).toHaveLength(1)
    expect(result?.kits[0].slug).toBe('valid')
  })

  it('returns null when the result has no kits', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: {},
            status: 'completed',
            result: { success: false, kits: [] },
          },
        ],
      },
    ]
    expect(findLatestDesignKitSuggest(messages)).toBeNull()
  })

  it('returns the latest suggest when multiple exist', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            name: 'suggestDesignKits',
            input: {},
            status: 'completed',
            result: { kits: [{ slug: 'old', displayName: 'Old' }] },
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
            name: 'suggestDesignKits',
            input: {},
            status: 'completed',
            result: { kits: [{ slug: 'new', displayName: 'New' }] },
          },
        ],
      },
    ]

    const result = findLatestDesignKitSuggest(messages)
    expect(result?.toolCallId).toBe('tc2')
    expect(result?.kits[0].slug).toBe('new')
  })
})
