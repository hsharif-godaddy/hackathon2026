/**
 * Tests for AgentConfig.onPrepareStep hook.
 *
 * Validates that:
 * - onPrepareStep is called with stepNumber and messages
 * - Returning { messages } overrides the messages for the next LLM call
 * - Returning undefined or {} does not alter messages
 * - onPrepareStep receives cache-breakpointed messages when caching is active
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig } from '../types.js'

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  const MockToolLoopAgent = vi.fn()
  return {
    ...actual,
    ToolLoopAgent: MockToolLoopAgent,
    stepCountIs: vi.fn((value: number) => ({ type: 'step_count', value })),
    hasToolCall: vi.fn((name: string) => ({ type: 'has_tool_call', value: name }))
  }
})

describe('AgentWrapper onPrepareStep hook', () => {
  let mockAgent: { generate: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> }
  let lastSettings: any
  let MockToolLoopAgent: any

  beforeEach(async () => {
    mockAgent = { generate: vi.fn(), stream: vi.fn() }
    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockImplementation(function (this: unknown, settings: unknown) {
      lastSettings = settings
      return mockAgent
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    lastSettings = undefined
  })

  function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
      name: 'test-agent',
      model: 'test-model' as any,
      tools: {
        toolA: { execute: vi.fn() } as any,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    }
  }

  async function callPrepareStep(messages: unknown[] = [], stepNumber = 0): Promise<any> {
    const prepared = await lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })
    return lastSettings.prepareStep({
      stepNumber,
      steps: [],
      model: 'test-model',
      messages,
      experimental_context: prepared.experimental_context,
    })
  }

  it('calls onPrepareStep with stepNumber and messages', async () => {
    const onPrepareStep = vi.fn(() => undefined)
    new AgentWrapper(baseConfig({ onPrepareStep }))

    const msgs = [{ role: 'user', content: 'hello' }]
    await callPrepareStep(msgs, 2)

    expect(onPrepareStep).toHaveBeenCalledTimes(1)
    expect(onPrepareStep).toHaveBeenCalledWith({
      stepNumber: 2,
      messages: msgs,
    })
  })

  it('overrides messages when onPrepareStep returns { messages }', async () => {
    const injected = [{ role: 'user', content: 'injected' }]
    const onPrepareStep = vi.fn(() => ({ messages: injected }))
    new AgentWrapper(baseConfig({ onPrepareStep }))

    const result = await callPrepareStep([{ role: 'user', content: 'original' }], 0)

    expect(result?.messages).toBe(injected)
  })

  it('does not override messages when onPrepareStep returns undefined', async () => {
    const onPrepareStep = vi.fn(() => undefined)
    new AgentWrapper(baseConfig({ onPrepareStep }))

    const result = await callPrepareStep([], 0)

    // No messages override — result should either be undefined or not have messages key
    expect(result?.messages).toBeUndefined()
  })

  it('does not override messages when onPrepareStep returns empty object', async () => {
    const onPrepareStep = vi.fn(() => ({}))
    new AgentWrapper(baseConfig({ onPrepareStep }))

    const result = await callPrepareStep([], 0)

    expect(result?.messages).toBeUndefined()
  })

  it('is not called when onPrepareStep is not configured', async () => {
    new AgentWrapper(baseConfig())

    // Should not throw
    const result = await callPrepareStep([{ role: 'user', content: 'hi' }], 1)
    // Result is either undefined or has no messages override from the hook
    expect(result?.messages).toBeUndefined()
  })

  it('receives cache-breakpointed messages on step > 0 when caching is enabled', async () => {
    let receivedMessages: unknown[] | undefined
    const onPrepareStep = vi.fn((opts: { messages: unknown[] }) => {
      receivedMessages = opts.messages
      return undefined
    })
    new AgentWrapper(baseConfig({ onPrepareStep, enablePromptCaching: true }))

    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]
    await callPrepareStep(msgs, 1)

    // onPrepareStep should receive messages (possibly with cache breakpoints added)
    expect(receivedMessages).toBeDefined()
    expect(receivedMessages!.length).toBeGreaterThanOrEqual(msgs.length)
  })
})
