import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { findLatestAppliedColorScheme } from './findLatestAppliedColorScheme'

describe('findLatestAppliedColorScheme', () => {
  it('returns null for empty messages array', () => {
    expect(findLatestAppliedColorScheme([])).toBeNull()
  })

  it('returns null when no assistant messages exist', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello',
        
      },
    ]
    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })

  it('returns null when no colorScheme tool calls exist', () => {
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
    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })

  it('returns null when colorScheme mode is not "apply"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'suggest' },
            status: 'completed',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })

  it('returns null when colorScheme status is not "completed"', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'running',
            result: {},
          },
        ],
      },
    ]
    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })

  it('extracts applied palette with custom name', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'Ocean Blue',
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
          },
        ],
      },
    ]

    const result = findLatestAppliedColorScheme(messages)
    expect(result).toEqual({
      name: 'Ocean Blue',
      theme: undefined,
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
    })
  })

  it('defaults to "Current Theme" when paletteName is missing', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
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
          },
        ],
      },
    ]

    const result = findLatestAppliedColorScheme(messages)
    expect(result?.name).toBe('Current Theme')
  })

  it('extracts theme property from palette', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'Dark Mode',
              palette: {
                background: '#000000',
                foreground: '#ffffff',
                primary: '#0066cc',
                primaryForeground: '#ffffff',
                secondary: '#6c757d',
                secondaryForeground: '#ffffff',
                accent: '#ff6b6b',
                accentForeground: '#ffffff',
                muted: '#1a1a1a',
                mutedForeground: '#cccccc',
                theme: 'dark',
              },
            },
          },
        ],
      },
    ]

    const result = findLatestAppliedColorScheme(messages)
    expect(result?.theme).toBe('dark')
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
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'Old Theme',
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
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'New Theme',
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
          },
        ],
      },
    ]

    const result = findLatestAppliedColorScheme(messages)
    expect(result?.name).toBe('New Theme')
  })

  it('returns null when palette is missing required fields', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'Incomplete',
              palette: {
                background: '#ffffff',
                // Missing foreground
              },
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })

  it('returns null when result has no palette', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'colorScheme',
            input: { mode: 'apply' },
            status: 'completed',
            result: {
              paletteName: 'No Palette',
            },
          },
        ],
      },
    ]

    expect(findLatestAppliedColorScheme(messages)).toBeNull()
  })
})
