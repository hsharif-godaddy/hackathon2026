import { describe, it, expect } from 'vitest'
import {
  normalizeContextMessages,
  normalizeConversationMessages,
  defaultConvertToLlm,
  applyPromptCaching,
} from '../context-normalization.js'
import type { ModelMessage } from 'ai'

describe('normalizeContextMessages', () => {
  it('converts cache points to Anthropic and Bedrock provider options', () => {
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a helpful agent',
        cachePoint: { type: 'ephemeral' as const },
      },
    ]
    const result = normalizeContextMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]!.role).toBe('system')
    expect(result[0]!.content).toBe('You are a helpful agent')
    expect(
      (result[0] as any).providerOptions?.anthropic?.cacheControl
    ).toEqual({ type: 'ephemeral' })
    expect((result[0] as any).providerOptions?.bedrock?.cachePoint).toBe(
      'ephemeral'
    )
  })

  it('passes through messages without cache points unchanged', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const result = normalizeContextMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
  })

  it('handles empty array', () => {
    expect(normalizeContextMessages([])).toEqual([])
  })
})

describe('normalizeConversationMessages', () => {
  it('converts cachePoint on conversation messages', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'hello',
        cachePoint: { type: 'ephemeral' },
      } as ModelMessage & { cachePoint: { type: string } },
    ]
    const result = normalizeConversationMessages(messages)
    expect(result).toHaveLength(1)
    expect((result[0] as any).providerOptions?.anthropic?.cacheControl).toEqual(
      { type: 'ephemeral' }
    )
    // cachePoint property should be stripped
    expect((result[0] as any).cachePoint).toBeUndefined()
  })

  it('passes through messages without cachePoint as-is', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    const result = normalizeConversationMessages(messages)
    expect(result).toEqual(messages)
  })
})

describe('defaultConvertToLlm', () => {
  it('assembles context + history + user message in order', () => {
    const result = defaultConvertToLlm({
      contextMessages: [{ role: 'system', content: 'system prompt' }],
      conversationMessages: [
        { role: 'user', content: 'previous message' },
      ] as ModelMessage[],
      userMessage: { role: 'user', content: 'current message' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'previous message',
      'current message',
    ])
  })

  it('handles empty context and conversation', () => {
    const result = defaultConvertToLlm({
      contextMessages: [],
      conversationMessages: [] as ModelMessage[],
      userMessage: { role: 'user', content: 'hello' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('hello')
  })

  it('places after_history context after conversation messages', () => {
    const result = defaultConvertToLlm({
      contextMessages: [
        { role: 'system', content: 'system prompt', insertionOrder: 'before_history' },
        { role: 'user', content: 'visual context', insertionOrder: 'after_history' },
        { role: 'system', content: 'template info' }, // default = before_history
      ],
      conversationMessages: [
        { role: 'user', content: 'previous' },
        { role: 'assistant', content: 'response' },
      ] as ModelMessage[],
      userMessage: { role: 'user', content: 'current' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'template info',
      'previous',
      'response',
      'visual context',
      'current',
    ])
  })

  it('handles all messages as after_history', () => {
    const result = defaultConvertToLlm({
      contextMessages: [
        { role: 'user', content: 'error context', insertionOrder: 'after_history' },
      ],
      conversationMessages: [
        { role: 'user', content: 'history' },
      ] as ModelMessage[],
      userMessage: { role: 'user', content: 'current' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result.map((m) => m.content)).toEqual([
      'history',
      'error context',
      'current',
    ])
  })

  it('applies caching breakpoints with after_history messages in correct order', () => {
    const mockModel = {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
    } as any

    const result = defaultConvertToLlm({
      contextMessages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'visual context', insertionOrder: 'after_history' },
      ],
      conversationMessages: [
        { role: 'user', content: 'prev' },
        { role: 'assistant', content: 'reply' },
      ] as ModelMessage[],
      userMessage: { role: 'user', content: 'current' } as ModelMessage,
      model: mockModel,
      enablePromptCaching: true,
    })

    // Order should be: system prompt → conversation → visual context → current user
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'prev',
      'reply',
      'visual context',
      'current',
    ])
    // Subsequent turn (has assistant message): cache breakpoint should land on
    // the last STABLE message (conversation history 'reply'), NOT on after_history
    // content like 'visual context' which is dynamic and changes every request.
    // This prevents cache invalidation when after_history content changes.
    const cachedIndices = result
      .map((m, i) => ((m as any).providerOptions?.anthropic?.cacheControl ? i : -1))
      .filter((i) => i >= 0)
    // Last stable message is 'reply' at index 2 (before after_history)
    expect(cachedIndices).toContain(2)
    // after_history message 'visual context' should NOT be cached
    expect((result[3] as any).providerOptions?.anthropic?.cacheControl).toBeUndefined()
    // System prompt should NOT be cached on subsequent turns
    expect((result[0] as any).providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('first turn with after_history context caches stable prefix only, not user message', () => {
    const mockModel = {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
    } as any

    const result = defaultConvertToLlm({
      contextMessages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'knowb results', insertionOrder: 'after_history' },
      ],
      conversationMessages: [] as ModelMessage[],
      userMessage: { role: 'user', content: 'hello' } as ModelMessage,
      model: mockModel,
      enablePromptCaching: true,
    })

    // Order should be: system prompt → knowb results → hello
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'knowb results',
      'hello',
    ])
    // First turn: only system prompt should be cached (stable prefix)
    expect((result[0] as any).providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    // after_history 'knowb results' should NOT be cached (outside cached prefix)
    expect((result[1] as any).providerOptions?.anthropic?.cacheControl).toBeUndefined()
    // User message should NOT be cached on first turn (comes after after_history)
    expect((result[2] as any).providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('orders multiple after_history messages correctly (knowb → todo → dynamic)', () => {
    const result = defaultConvertToLlm({
      contextMessages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'knowb results', insertionOrder: 'after_history' },
        { role: 'user', content: 'todo list', insertionOrder: 'after_history' },
        { role: 'user', content: 'dynamic data', insertionOrder: 'after_history' },
      ],
      conversationMessages: [
        { role: 'user', content: 'prev' },
        { role: 'assistant', content: 'reply' },
      ] as ModelMessage[],
      userMessage: { role: 'user', content: 'current' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })

    // Order should be: system → history → after_history (in order) → current user
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'prev',
      'reply',
      'knowb results',
      'todo list',
      'dynamic data',
      'current',
    ])
  })

  it('omits user message when userMessage is undefined', () => {
    const result = defaultConvertToLlm({
      contextMessages: [{ role: 'system', content: 'system prompt' }],
      conversationMessages: [
        { role: 'user', content: 'previous' },
      ] as ModelMessage[],
      userMessage: undefined,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result.map((m) => m.content)).toEqual([
      'system prompt',
      'previous',
    ])
  })

  it('preserves cache points on context messages through assembly', () => {
    const result = defaultConvertToLlm({
      contextMessages: [
        {
          role: 'system',
          content: 'cached system prompt',
          cachePoint: { type: 'ephemeral' as const },
        },
      ],
      conversationMessages: [] as ModelMessage[],
      userMessage: { role: 'user', content: 'hello' } as ModelMessage,
      model: {} as any,
      enablePromptCaching: false,
    })
    expect(result).toHaveLength(2)
    expect(
      (result[0] as any).providerOptions?.anthropic?.cacheControl
    ).toEqual({ type: 'ephemeral' })
  })
})

describe('normalizeContextMessages — providerOptions', () => {
  it('preserves existing providerOptions on context messages', () => {
    const messages = [
      {
        role: 'system' as const,
        content: 'system prompt',
        providerOptions: { anthropic: { effort: 'medium' } },
      },
    ]
    const result = normalizeContextMessages(messages)
    expect((result[0] as any).providerOptions?.anthropic?.effort).toBe('medium')
  })

  it('merges cachePoint into existing providerOptions without overwriting', () => {
    const messages = [
      {
        role: 'system' as const,
        content: 'system prompt',
        cachePoint: { type: 'ephemeral' as const },
        providerOptions: { anthropic: { effort: 'medium' } },
      },
    ]
    const result = normalizeContextMessages(messages)
    const opts = (result[0] as any).providerOptions
    // Cache control merged in
    expect(opts.anthropic.cacheControl).toEqual({ type: 'ephemeral' })
    // Existing option preserved
    expect(opts.anthropic.effort).toBe('medium')
    // Bedrock also set
    expect(opts.bedrock.cachePoint).toBe('ephemeral')
  })
})

describe('applyPromptCaching', () => {
  const mockModel = {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022',
  } as any

  it('does not cache system messages on subsequent turns', () => {
    const systemMsg = { role: 'system', content: 'system prompt' } as ModelMessage
    const historyUser = { role: 'user', content: 'prev' } as ModelMessage
    const historyAssistant = { role: 'assistant', content: 'reply' } as ModelMessage
    const allMessages = [systemMsg, historyUser, historyAssistant]
    const userMessage = { role: 'user', content: 'current' } as ModelMessage
    // Conversation has assistant messages = subsequent turn
    const conversationMessages = [historyUser, historyAssistant]

    const result = applyPromptCaching(
      allMessages,
      userMessage,
      mockModel,
      conversationMessages,
      true
    )

    // System message should NOT have cache control (already cached at ToolLoopAgent level)
    const systemResult = result.messages.find((m) => m.content === 'system prompt')
    expect((systemResult as any).providerOptions?.anthropic?.cacheControl).toBeUndefined()
    // Last history message should have cache control
    const lastHistory = result.messages.find((m) => m.content === 'reply')
    expect((lastHistory as any).providerOptions?.anthropic?.cacheControl).toBeDefined()
  })

  it('caches system messages on first turn', () => {
    const systemMsg = { role: 'system', content: 'system prompt' } as ModelMessage
    const allMessages = [systemMsg]
    const userMessage = { role: 'user', content: 'hello' } as ModelMessage
    // No assistant messages = first turn
    const conversationMessages: ModelMessage[] = []

    const result = applyPromptCaching(
      allMessages,
      userMessage,
      mockModel,
      conversationMessages,
      true
    )

    // On first turn, system prompt should be cached
    const cachedMessages = [...result.messages, result.userMessage].filter(
      (m) => (m as any)?.providerOptions?.anthropic?.cacheControl
    )
    expect(cachedMessages.length).toBeGreaterThan(0)
  })

  it('never exceeds 4 Anthropic cache breakpoints for a full request', () => {
    // Simulate a large subsequent-turn request with many messages
    const systemMsg = { role: 'system', content: 'system prompt' } as ModelMessage
    const contextUser = { role: 'user', content: 'visual context' } as ModelMessage
    const history: ModelMessage[] = []
    for (let i = 0; i < 10; i++) {
      history.push({ role: 'user', content: `user ${i}` } as ModelMessage)
      history.push({ role: 'assistant', content: `reply ${i}` } as ModelMessage)
    }
    const allMessages = [systemMsg, contextUser, ...history]
    const userMessage = { role: 'user', content: 'current' } as ModelMessage

    const result = applyPromptCaching(
      allMessages,
      userMessage,
      mockModel,
      history,
      true
    )

    const totalBreakpoints = [...result.messages, result.userMessage].filter(
      (m) => (m as any)?.providerOptions?.anthropic?.cacheControl
    ).length
    // Anthropic hard limit is 4 breakpoints
    expect(totalBreakpoints).toBeLessThanOrEqual(4)
  })

  it('still caches context messages when userMessage is undefined', () => {
    const systemMsg = { role: 'system', content: 'system prompt' } as ModelMessage
    const historyUser = { role: 'user', content: 'prev' } as ModelMessage
    const historyAssistant = { role: 'assistant', content: 'reply' } as ModelMessage
    const allMessages = [systemMsg, historyUser, historyAssistant]
    const conversationMessages = [historyUser, historyAssistant]

    const result = applyPromptCaching(
      allMessages,
      undefined, // no user message (empty prompt, no files)
      mockModel,
      conversationMessages,
      true
    )

    // Context/history messages should still get cache breakpoints
    const cachedMessages = result.messages.filter(
      (m) => (m as any).providerOptions?.anthropic?.cacheControl
    )
    expect(cachedMessages.length).toBeGreaterThan(0)
    // Last history message should be cached
    const lastHistory = result.messages.find((m) => m.content === 'reply')
    expect((lastHistory as any).providerOptions?.anthropic?.cacheControl).toBeDefined()
    // userMessage should remain undefined
    expect(result.userMessage).toBeUndefined()
  })
})
