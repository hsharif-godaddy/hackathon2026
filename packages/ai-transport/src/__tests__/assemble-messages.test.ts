import { describe, it, expect } from 'vitest'
import { assembleMessages, dropTrailingPrompt } from '../assemble-messages.js'

describe('assembleMessages', () => {
  it('splits context by insertionOrder: before→beforeHistory, after→afterHistory (NOT messages)', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'before', insertionOrder: 'before_history' },
        { role: 'user', content: 'after', insertionOrder: 'after_history' },
      ],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(1)
    expect(result.beforeHistory[0]!.content).toBe('before')
    // after_history must stay OUT of the cacheable conversation array
    expect(result.messages).toHaveLength(0)
    expect(result.afterHistory).toHaveLength(1)
    expect(result.afterHistory[0]!.content).toBe('after')
    expect(result.afterHistory[0]!.insertionOrder).toBe('after_history')
  })

  it('treats missing insertionOrder as after_history (routed to afterHistory, tagged)', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'no-order' },
      ],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(0)
    expect(result.messages).toHaveLength(0)
    expect(result.afterHistory).toHaveLength(1)
    expect(result.afterHistory[0]!.content).toBe('no-order')
    expect(result.afterHistory[0]!.insertionOrder).toBe('after_history')
  })

  it('preserves cachePoint on context messages', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'ctx', insertionOrder: 'before_history', cachePoint: { type: 'ephemeral' } },
      ],
      conversationHistory: [],
    })
    expect(result.beforeHistory[0]!.cachePoint).toEqual({ type: 'ephemeral' })
  })

  it('preserves tool_calls on assistant history messages only', () => {
    const toolCalls = [{ id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } }]
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [
        { role: 'assistant', content: 'hi', tool_calls: toolCalls },
        { role: 'user', content: 'msg', tool_calls: toolCalls },
        { role: 'tool', content: 'result' },
      ],
    })
    expect(result.messages[0]!.tool_calls).toEqual(toolCalls)
    expect(result.messages[1]!.tool_calls).toBeUndefined()
    expect(result.messages[2]!.tool_calls).toBeUndefined()
  })

  it('messages holds only the stable prefix (history + preflight); volatile content moves to afterHistory', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'after-ctx', insertionOrder: 'after_history' },
      ],
      conversationHistory: [
        { role: 'user', content: 'history' },
      ],
      preflightMessages: [
        { role: 'assistant', content: 'preflight' },
      ],
      extraAfterHistory: [
        { role: 'user', content: 'rag-context' },
      ],
    })
    // Cacheable prefix only
    expect(result.messages.map(m => m.content)).toEqual(['history', 'preflight'])
    // Volatile tail, in order: context after_history then extraAfterHistory, all tagged
    expect(result.afterHistory.map(m => m.content)).toEqual(['after-ctx', 'rag-context'])
    expect(result.afterHistory.every(m => m.insertionOrder === 'after_history')).toBe(true)
  })

  it('preserves cachePoint when routing extraAfterHistory into afterHistory', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [{ role: 'user', content: 'history' }],
      extraAfterHistory: [
        { role: 'user', content: 'rag', cachePoint: { type: 'ephemeral' } },
      ],
    })
    expect(result.afterHistory).toHaveLength(1)
    expect(result.afterHistory[0]!.cachePoint).toEqual({ type: 'ephemeral' })
    expect(result.afterHistory[0]!.insertionOrder).toBe('after_history')
  })

  it('preserves cachePoint when routing after_history context into afterHistory', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'volatile ctx', insertionOrder: 'after_history', cachePoint: { type: 'ephemeral' } },
      ],
      conversationHistory: [{ role: 'user', content: 'history' }],
    })

    expect(result.messages.map(m => m.content)).toEqual(['history'])
    expect(result.afterHistory).toHaveLength(1)
    expect(result.afterHistory[0]).toEqual(expect.objectContaining({
      content: 'volatile ctx',
      cachePoint: { type: 'ephemeral' },
      insertionOrder: 'after_history',
    }))
  })

  it('passes through history messages unchanged', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [
        { role: 'tool', content: 'orphan', tool_calls: undefined },
      ],
    })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.role).toBe('tool')
  })

  it('handles empty inputs', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(0)
    expect(result.afterHistory).toHaveLength(0)
    expect(result.messages).toHaveLength(0)
  })

  describe('currentPrompt dedup', () => {
    it('drops a trailing user history message equal to currentPrompt', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: 'first turn' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'Just respond hello' },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages.map(m => m.content)).toEqual(['first turn', 'reply'])
    })

    it('keeps a trailing user message that does not match currentPrompt', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: 'something else' },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages.map(m => m.content)).toEqual(['something else'])
    })

    it('keeps a matching message when the trailing message is not a user message', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: 'Just respond hello' },
          { role: 'assistant', content: 'Just respond hello' },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages.map(m => m.content)).toEqual([
        'Just respond hello',
        'Just respond hello',
      ])
    })

    it('matches against the text of a parts-array user message', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: [{ type: 'text', text: 'Just respond hello' }] },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages).toHaveLength(0)
    })

    it('compares with whitespace trimmed', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: '  Just respond hello  ' },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages).toHaveLength(0)
    })

    it('only drops the last matching message, not earlier duplicates', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: 'Just respond hello' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'Just respond hello' },
        ],
        currentPrompt: 'Just respond hello',
      })
      expect(result.messages.map(m => m.content)).toEqual([
        'Just respond hello',
        'ok',
      ])
    })

    it('leaves history unchanged when currentPrompt is omitted', () => {
      const result = assembleMessages({
        contextMessages: [],
        conversationHistory: [
          { role: 'user', content: 'Just respond hello' },
        ],
      })
      expect(result.messages.map(m => m.content)).toEqual(['Just respond hello'])
    })
  })
})

describe('dropTrailingPrompt', () => {
  it('drops a trailing user message equal to currentPrompt', () => {
    const history = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'now' },
    ]
    expect(dropTrailingPrompt(history, 'now')).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ])
  })

  it('returns the same array reference when nothing is dropped', () => {
    const history = [{ role: 'user', content: 'now' }]
    expect(dropTrailingPrompt(history, 'different')).toBe(history)
  })

  it('returns the same array reference when currentPrompt is omitted', () => {
    const history = [{ role: 'user', content: 'now' }]
    expect(dropTrailingPrompt(history)).toBe(history)
  })

  it('does not drop when the trailing message is not a user message', () => {
    const history = [{ role: 'assistant', content: 'now' }]
    expect(dropTrailingPrompt(history, 'now')).toBe(history)
  })

  it('matches parts-array content and trims whitespace', () => {
    const history = [{ role: 'user', content: [{ type: 'text', text: '  now  ' }] }]
    expect(dropTrailingPrompt(history, 'now')).toEqual([])
  })

  it('handles empty history', () => {
    const history: Array<{ role: string; content: unknown }> = []
    expect(dropTrailingPrompt(history, 'now')).toBe(history)
  })
})
