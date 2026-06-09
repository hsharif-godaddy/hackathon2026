/**
 * Tests for callable AgentConfig.system and AgentConfig.activeTools resolvers.
 *
 * Validates that:
 * - String form of `system` continues to be passed via constructor `instructions`
 * - Function form of `system` is invoked once per turn (in prepareCall) and
 *   surfaced via PrepareStepResult.system
 * - Function form of `activeTools` filters base tool names by intersection
 * - ResolverContext exposes profileName / market promoted from executionContext.metadata
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig, ResolverContext } from '../types.js'

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

describe('AgentWrapper resolver-callable system and activeTools', () => {
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
        toolB: { execute: vi.fn() } as any,
        toolC: { execute: vi.fn() } as any,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    }
  }

  it('passes string `system` to ToolLoopAgent instructions at construction', () => {
    new AgentWrapper(baseConfig({ system: 'static prompt' }))
    expect(lastSettings.instructions).toBe('static prompt')
  })

  it('does not set ToolLoopAgent instructions when `system` is a function', () => {
    const resolver = vi.fn(async () => 'resolved prompt')
    new AgentWrapper(baseConfig({ system: resolver }))
    expect(lastSettings.instructions).toBeUndefined()
  })

  it('invokes the system resolver once in prepareCall and exposes ResolverContext fields', async () => {
    let capturedCtx: ResolverContext | undefined
    const resolver = vi.fn(async (ctx: ResolverContext) => {
      capturedCtx = ctx
      return `prompt-for-${ctx.profileName ?? 'none'}-${ctx.market ?? 'none'}`
    })
    new AgentWrapper(baseConfig({ system: resolver }))

    await lastSettings.prepareCall({
      prompt: 'hi',
      options: {
        executionContext: {
          metadata: { profileName: 'experimental', market: 'en-US', conversationId: 'c1' },
        },
      },
    })

    expect(resolver).toHaveBeenCalledTimes(1)
    expect(capturedCtx?.profileName).toBe('experimental')
    expect(capturedCtx?.market).toBe('en-US')
    // ResolverContext intentionally does NOT carry the executionContext.metadata
    // bag — only the promoted profileName + market. Adding fields here is a
    // contract change and should be done deliberately in types.ts.
    expect((capturedCtx as Record<string, unknown>)?.metadata).toBeUndefined()
  })

  it('returns the resolved system from prepareStep so the SDK overrides instructions per turn', async () => {
    const resolver = vi.fn(async (ctx: ResolverContext) =>
      ctx.profileName === 'a' ? 'PROMPT_A' : 'PROMPT_DEFAULT'
    )
    new AgentWrapper(baseConfig({ system: resolver }))

    const prepared = await lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: { profileName: 'a' } } },
    })
    // Pass the experimental_context produced by prepareCall — that's where
    // resolver outputs are threaded (concurrency-safe vs instance state).
    const stepResult = await lastSettings.prepareStep({
      stepNumber: 0, steps: [], model: 'test-model', messages: [],
      experimental_context: prepared.experimental_context,
    })
    expect(stepResult?.system).toBe('PROMPT_A')
  })

  it('intersects base tools with the resolved activeTools list', async () => {
    const resolver = vi.fn(async () => ['toolA', 'toolC'])
    new AgentWrapper(baseConfig({ activeTools: resolver }))

    const prepared = await lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })
    const stepResult = await lastSettings.prepareStep({
      stepNumber: 0, steps: [], model: 'test-model', messages: [],
      experimental_context: prepared.experimental_context,
    })
    expect(stepResult?.activeTools).toEqual(['toolA', 'toolC'])
  })

  it('omits activeTools override when no resolver and no skill provider', async () => {
    // With no resolver and no skill provider, prepareStep should not issue an
    // activeTools override — the SDK uses the full constructor tools list,
    // matching pre-resolver behavior.
    new AgentWrapper(baseConfig())

    const prepared = await lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })
    const stepResult = await lastSettings.prepareStep({
      stepNumber: 0, steps: [], model: 'test-model', messages: [],
      experimental_context: prepared.experimental_context,
    })
    expect(stepResult?.activeTools).toBeUndefined()
  })

  it('treats activeTools as static intersection when given a plain array', async () => {
    new AgentWrapper(baseConfig({ activeTools: ['toolB'] }))

    const prepared = await lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })
    const stepResult = await lastSettings.prepareStep({
      stepNumber: 0, steps: [], model: 'test-model', messages: [],
      experimental_context: prepared.experimental_context,
    })
    expect(stepResult?.activeTools).toEqual(['toolB'])
  })

  it('fails the turn when the system resolver throws (fail-closed)', async () => {
    const resolver = vi.fn(async () => { throw new Error('boom') })
    new AgentWrapper(baseConfig({
      system: resolver,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))

    await expect(lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })).rejects.toThrow('boom')
  })

  it('fails the turn when the activeTools resolver throws (fail-closed)', async () => {
    const resolver = vi.fn(async () => { throw new Error('tools-boom') })
    new AgentWrapper(baseConfig({
      activeTools: resolver,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))

    await expect(lastSettings.prepareCall({
      prompt: 'hi',
      options: { executionContext: { metadata: {} } },
    })).rejects.toThrow('tools-boom')
  })
})
