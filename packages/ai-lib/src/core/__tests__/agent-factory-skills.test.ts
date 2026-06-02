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
    stepCountIs: vi.fn(function (value: number) { return { type: 'step_count', value }; }),
    hasToolCall: vi.fn(function (name: string) { return { type: 'has_tool_call', value: name }; })
  }
})

function createMockSkillToolProvider(overrides: Partial<SkillToolProvider> = {}): SkillToolProvider {
  return {
    getAllTools: vi.fn(function () { return {
      'skill__foo__doStuff': { execute: vi.fn() } as any,
      'skill__bar__doOther': { execute: vi.fn() } as any
    }; }),
    getSkillToolNames: vi.fn(function () { return ['skill__foo__doStuff', 'skill__bar__doOther']; }),
    getActiveToolNames: vi.fn(function () { return ['skill__foo__doStuff']; }),
    updateSkillUsage: vi.fn(),
    cleanupInactiveSkills: vi.fn(function () { return []; }),
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
    MockToolLoopAgent.mockImplementation(function (settings: unknown) {
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
      getActiveToolNames: vi.fn(function () { return activeSkills; })
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
      cleanupInactiveSkills: vi.fn(function () { return ['skill__bar__doOther']; })
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

describe('AgentWrapper initialSkills auto-registration', () => {
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
    MockToolLoopAgent.mockImplementation(function (settings: unknown) {
      lastSettings = settings
      return mockAgent
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    lastSettings = undefined
  })

  it('should call onSkillsLoad on first prepareCall', async () => {
    const onSkillsLoad = vi.fn(async function () { return [
      { role: 'system' as const, content: '# Media Logo\nUse this skill...', insertionOrder: 'after_history' as const }
    ]; })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    await lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    })

    expect(onSkillsLoad).toHaveBeenCalledTimes(1)
    expect(onSkillsLoad).toHaveBeenCalledWith('conv-456')
  })

  it('should not re-call onSkillsLoad on subsequent prepareCall invocations', async () => {
    const onSkillsLoad = vi.fn(async function () { return [
      { role: 'system' as const, content: 'skill instructions', insertionOrder: 'after_history' as const }
    ]; })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    const callArgs = {
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    }

    await lastSettings.prepareCall(callArgs)
    await lastSettings.prepareCall(callArgs)
    await lastSettings.prepareCall(callArgs)

    expect(onSkillsLoad).toHaveBeenCalledTimes(1)
  })

  it('should retry onSkillsLoad when it returns empty array', async () => {
    let callCount = 0
    const onSkillsLoad = vi.fn(async function () {
      callCount++
      if (callCount >= 2) {
        return [{ role: 'system' as const, content: 'skill instructions', insertionOrder: 'after_history' as const }]
      }
      return []
    })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    const callArgs = {
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    }

    // First call returns [], should not mark as loaded (will retry next time)
    await lastSettings.prepareCall(callArgs)
    expect(onSkillsLoad).toHaveBeenCalledTimes(1)

    // Second call retries and succeeds
    await lastSettings.prepareCall(callArgs)
    expect(onSkillsLoad).toHaveBeenCalledTimes(2)

    // Third call is deduplicated (success was recorded)
    await lastSettings.prepareCall(callArgs)
    expect(onSkillsLoad).toHaveBeenCalledTimes(2)
  })

  it('should stop retrying onSkillsLoad after 3 failed attempts', async () => {
    const onSkillsLoad = vi.fn(async function () { return []; })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    const callArgs = {
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    }

    // 3 attempts, then stops
    await lastSettings.prepareCall(callArgs)
    await lastSettings.prepareCall(callArgs)
    await lastSettings.prepareCall(callArgs)
    expect(onSkillsLoad).toHaveBeenCalledTimes(3)

    // 4th call — should NOT retry
    await lastSettings.prepareCall(callArgs)
    expect(onSkillsLoad).toHaveBeenCalledTimes(3)
  })

  it('should call onSkillsLoad once per conversation when reused across conversations', async () => {
    const onSkillsLoad = vi.fn(async function () { return [
      { role: 'system' as const, content: 'skill instructions', insertionOrder: 'after_history' as const }
    ]; })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    await lastSettings.prepareCall({
      prompt: 'test', messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-first' } } }
    })
    await lastSettings.prepareCall({
      prompt: 'test', messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-first' } } }
    })
    await lastSettings.prepareCall({
      prompt: 'test', messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-second' } } }
    })
    await lastSettings.prepareCall({
      prompt: 'test', messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-second' } } }
    })

    expect(onSkillsLoad).toHaveBeenCalledTimes(2)
    expect(onSkillsLoad).toHaveBeenNthCalledWith(1, 'conv-first')
    expect(onSkillsLoad).toHaveBeenNthCalledWith(2, 'conv-second')
  })

  it('should not call onSkillsLoad when not configured', async () => {
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    // Should complete without error — no onSkillsLoad configured
    await expect(lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    })).resolves.not.toThrow()
  })

  it('should handle onSkillsLoad failure gracefully without throwing', async () => {
    const onSkillsLoad = vi.fn(async function () { throw new Error('skill load failed') })
    const skillProvider = createMockSkillToolProvider()

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test assistant',
      tools: { baseTool: { execute: vi.fn() } as any },
      onSkillsLoad,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config, skillProvider)

    // Should not throw — failure is caught and logged
    await expect(lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-456' } } }
    })).resolves.not.toThrow()

    expect(onSkillsLoad).toHaveBeenCalledWith('conv-456')
  })
})
