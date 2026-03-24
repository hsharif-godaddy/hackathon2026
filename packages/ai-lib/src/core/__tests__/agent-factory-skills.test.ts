/**
 * Tests for skill tool cleanup timing and activeTools stability.
 *
 * Validates that:
 * - cleanupInactiveSkills runs once in prepareCall (start of run), not per-step
 * - currentBaseToolNames remains stable across steps within the same run
 * - New skills activated mid-run are picked up in prepareStep
 * - Skill tools are only merged into agents that declare the 'skill' loader tool
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper, AgentFactory } from '../agent-factory.js'
import type { AgentConfig, SkillToolProvider } from '../types.js'

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

function createMockSkillToolProvider(overrides: Partial<SkillToolProvider> = {}): SkillToolProvider {
  return {
    getAllTools: vi.fn(() => ({
      'skill__foo__doStuff': { execute: vi.fn() } as any,
      'skill__bar__doOther': { execute: vi.fn() } as any
    })),
    getSkillToolNames: vi.fn(() => ['skill__foo__doStuff', 'skill__bar__doOther']),
    getActiveToolNames: vi.fn(() => ['skill__foo__doStuff']),
    updateSkillUsage: vi.fn(),
    cleanupInactiveSkills: vi.fn(() => []),
    ...overrides
  }
}

describe('AgentWrapper skill cleanup and activeTools stability', () => {
  let mockAgent: {
    generate: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }
  let lastSettings: any
  let MockToolLoopAgent: any

  beforeEach(async () => {
    mockAgent = {
      generate: vi.fn(),
      stream: vi.fn()
    }

    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockImplementation((settings: unknown) => {
      lastSettings = settings
      return mockAgent
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    lastSettings = undefined
  })

  it('should call cleanupInactiveSkills once in prepareCall, not in prepareStep', async () => {
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: {
        baseTool: { execute: vi.fn() } as any,
        skill__foo__doStuff: { execute: vi.fn() } as any,
        skill__bar__doOther: { execute: vi.fn() } as any
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    // Mock a generate call that captures the internal callArgs
    mockAgent.generate.mockResolvedValueOnce({
      text: 'response',
      usage: Promise.resolve({ totalTokens: 10, promptTokens: 5, completionTokens: 5 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([])
    })

    const agentWrapper = new AgentWrapper(config, skillProvider)
    await agentWrapper.generate('test prompt', {
      executionContext: { metadata: { conversationId: 'conv-123' } }
    })

    // prepareCall was invoked internally — verify the captured settings
    const callArgs = mockAgent.generate.mock.calls[0][0]
    // Reset spy counts to isolate our direct calls
    ;(skillProvider.cleanupInactiveSkills as ReturnType<typeof vi.fn>).mockClear()

    // Call prepareCall directly (simulates start of a new run)
    await lastSettings.prepareCall({
      ...callArgs,
      options: { executionContext: { metadata: { conversationId: 'conv-123' } } }
    })

    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledTimes(1)
    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledWith('conv-123', expect.any(Number))

    // Simulate multiple prepareStep calls
    const stepArgs = { stepNumber: 1, steps: [], model: 'test-model', messages: [] }
    await lastSettings.prepareStep?.(stepArgs)
    await lastSettings.prepareStep?.({ ...stepArgs, stepNumber: 2 })
    await lastSettings.prepareStep?.({ ...stepArgs, stepNumber: 3 })

    // cleanupInactiveSkills should NOT have been called again during steps
    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledTimes(1)
  })

  it('should return stable activeTools across steps when no new skills activate', async () => {
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: {
        baseTool: { execute: vi.fn() } as any,
        skill__foo__doStuff: { execute: vi.fn() } as any,
        skill__bar__doOther: { execute: vi.fn() } as any
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    // Trigger prepareCall via options to set up currentBaseToolNames
    await lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-123' } } }
    })

    const stepArgs = { stepNumber: 1, steps: [], model: 'test-model', messages: [] }
    const step1Result = await lastSettings.prepareStep?.(stepArgs)
    const step2Result = await lastSettings.prepareStep?.({ ...stepArgs, stepNumber: 2 })

    // activeTools should be identical arrays (same base tools + same active skills)
    expect(step1Result.activeTools).toEqual(step2Result.activeTools)
    // Should contain base tool + active skill tool
    expect(step1Result.activeTools).toContain('baseTool')
    expect(step1Result.activeTools).toContain('skill__foo__doStuff')
    // Should NOT contain inactive skill tool
    expect(step1Result.activeTools).not.toContain('skill__bar__doOther')
  })

  it('should pick up newly activated skills in prepareStep', async () => {
    let activeSkills = ['skill__foo__doStuff']
    const skillProvider = createMockSkillToolProvider({
      getActiveToolNames: vi.fn(() => activeSkills)
    })

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: {
        baseTool: { execute: vi.fn() } as any,
        skill__foo__doStuff: { execute: vi.fn() } as any,
        skill__bar__doOther: { execute: vi.fn() } as any
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    await lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-123' } } }
    })

    const stepArgs = { stepNumber: 1, steps: [], model: 'test-model', messages: [] }
    const step1Result = await lastSettings.prepareStep?.(stepArgs)
    expect(step1Result.activeTools).not.toContain('skill__bar__doOther')

    // Simulate skill activation mid-run
    activeSkills = ['skill__foo__doStuff', 'skill__bar__doOther']

    const step2Result = await lastSettings.prepareStep?.({ ...stepArgs, stepNumber: 2 })
    expect(step2Result.activeTools).toContain('skill__bar__doOther')
  })

  it('should not call cleanupInactiveSkills during prepareStep', async () => {
    const skillProvider = createMockSkillToolProvider({
      cleanupInactiveSkills: vi.fn(() => ['skill__bar__doOther'])
    })

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: {
        baseTool: { execute: vi.fn() } as any,
        skill__foo__doStuff: { execute: vi.fn() } as any,
        skill__bar__doOther: { execute: vi.fn() } as any
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    await lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-123' } } }
    })

    // Cleanup ran once in prepareCall
    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledTimes(1)

    // Steps should not trigger additional cleanup
    const stepArgs = { stepNumber: 5, steps: [], model: 'test-model', messages: [] }
    await lastSettings.prepareStep?.(stepArgs)
    await lastSettings.prepareStep?.({ ...stepArgs, stepNumber: 6 })

    // Still only the one call from prepareCall
    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledTimes(1)
  })
})

describe('AgentFactory skill tool merge gating', () => {
  it('should not merge skill tools for agents without the skill loader tool', function noSkillLoader() {
    const skillProvider = createMockSkillToolProvider()
    const factory = new AgentFactory({ skillToolProvider: skillProvider })

    const agents = factory.defineAgents({
      initial: {
        name: 'Initial',
        model: 'test-model' as any,
        system: 'You are an initial assistant',
        tools: {
          todoList: { execute: vi.fn() } as any,
          askQuestion: { execute: vi.fn() } as any,
        }
      }
    })

    const merged = agents.getConfig('initial')

    expect(merged.tools).toHaveProperty('todoList')
    expect(merged.tools).toHaveProperty('askQuestion')
    expect(merged.tools).not.toHaveProperty('skill__foo__doStuff')
    expect(merged.tools).not.toHaveProperty('skill__bar__doOther')
    expect(skillProvider.getAllTools).not.toHaveBeenCalled()
  })

  it('should merge skill tools for agents that declare the skill loader tool', function withSkillLoader() {
    const skillProvider = createMockSkillToolProvider()
    const factory = new AgentFactory({ skillToolProvider: skillProvider })

    const agents = factory.defineAgents({
      develop: {
        name: 'Develop',
        model: 'test-model' as any,
        system: 'You are a develop assistant',
        tools: {
          baseTool: { execute: vi.fn() } as any,
          skill: { execute: vi.fn() } as any,
        }
      }
    })

    const merged = agents.getConfig('develop')

    expect(merged.tools).toHaveProperty('baseTool')
    expect(merged.tools).toHaveProperty('skill')
    expect(merged.tools).toHaveProperty('skill__foo__doStuff')
    expect(merged.tools).toHaveProperty('skill__bar__doOther')
    expect(skillProvider.getAllTools).toHaveBeenCalled()
  })

  it('should gate per-agent when defining multiple agents together', function mixedAgents() {
    const skillProvider = createMockSkillToolProvider()
    const factory = new AgentFactory({ skillToolProvider: skillProvider })

    const agents = factory.defineAgents({
      initial: {
        name: 'Initial',
        model: 'test-model' as any,
        system: 'Initial agent',
        tools: {
          todoList: { execute: vi.fn() } as any,
        }
      },
      develop: {
        name: 'Develop',
        model: 'test-model' as any,
        system: 'Develop agent',
        tools: {
          baseTool: { execute: vi.fn() } as any,
          skill: { execute: vi.fn() } as any,
        }
      }
    })

    const initialConfig = agents.getConfig('initial')
    const developConfig = agents.getConfig('develop')

    expect(initialConfig.tools).not.toHaveProperty('skill__foo__doStuff')
    expect(developConfig.tools).toHaveProperty('skill__foo__doStuff')
  })
})
