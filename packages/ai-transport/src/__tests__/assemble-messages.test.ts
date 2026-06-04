import { describe, it, expect } from 'vitest'
import { assembleMessages, dropTrailingPrompt } from '../assemble-messages.js'
import { stripLeadingOrphanTools } from '../strip-orphan-tools.js'

describe('stripLeadingOrphanTools', () => {
  it('removes leading tool messages and returns them', () => {
    const messages = [
      { role: 'tool', content: 'result', tool_call_id: 'tc1' },
      { role: 'tool', content: 'result2', tool_call_id: 'tc2' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'later', tool_call_id: 'tc3' },
    ]
    const removed = stripLeadingOrphanTools(messages)
    expect(removed).toHaveLength(2)
    expect(removed[0]!.tool_call_id).toBe('tc1')
    expect(removed[1]!.tool_call_id).toBe('tc2')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('assistant')
  })

  it('returns empty array when no leading tool messages', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const removed = stripLeadingOrphanTools(messages)
    expect(removed).toHaveLength(0)
    expect(messages).toHaveLength(2)
  })

  it('handles empty array', () => {
    const messages: Array<{ role: string }> = []
    const removed = stripLeadingOrphanTools(messages)
    expect(removed).toHaveLength(0)
  })

  it('strips all messages when all are tool-role', () => {
    const messages = [
      { role: 'tool', content: 'a', tool_call_id: 'x' },
      { role: 'tool', content: 'b', tool_call_id: 'y' },
    ]
    const removed = stripLeadingOrphanTools(messages)
    expect(removed).toHaveLength(2)
    expect(messages).toHaveLength(0)
  })
})

describe('assembleMessages', () => {
  it('splits context by insertionOrder', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'before', insertionOrder: 'before_history' },
        { role: 'user', content: 'after', insertionOrder: 'after_history' },
      ],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(1)
    expect(result.beforeHistory[0]!.content).toBe('before')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.content).toBe('after')
  })

  it('treats missing insertionOrder as after_history', () => {
    const result = assembleMessages({
      contextMessages: [
        { role: 'user', content: 'no-order' },
      ],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(0)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.content).toBe('no-order')
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

  it('orders: history, preflight, afterHistory, extraAfterHistory', () => {
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
    expect(result.messages.map(m => m.content)).toEqual([
      'history', 'preflight', 'after-ctx', 'rag-context',
    ])
  })

  it('strips orphan leading tool messages and returns them', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [
        { role: 'tool', content: 'orphan', tool_calls: undefined },
      ],
    })
    expect(result.strippedOrphanTools).toHaveLength(1)
    expect(result.messages).toHaveLength(0)
  })

  it('handles all-tool history (everything stripped)', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [
        { role: 'tool', content: 'a' },
        { role: 'tool', content: 'b' },
      ],
    })
    expect(result.strippedOrphanTools).toHaveLength(2)
    expect(result.messages).toHaveLength(0)
  })

  it('handles empty inputs', () => {
    const result = assembleMessages({
      contextMessages: [],
      conversationHistory: [],
    })
    expect(result.beforeHistory).toHaveLength(0)
    expect(result.messages).toHaveLength(0)
    expect(result.strippedOrphanTools).toHaveLength(0)
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
