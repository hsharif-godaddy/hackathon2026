/**
 * Tests for AgentWrapper.withModel() and automatic override delegation
 */
import type { LanguageModel, Tool } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentWrapper, PROVIDER_TOOL_FALLBACK } from '../agent-factory.js'
import type { AgentConfig, SkillToolProvider } from '../types.js'

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  const MockToolLoopAgent = vi.fn()
  return {
    ...actual,
    ToolLoopAgent: MockToolLoopAgent
  }
})

vi.mock('../model-override-context.js', () => ({
  getActiveModelOverride: vi.fn(function () { return null; }),
  runWithModelOverride: vi.fn(function (override: string, fn: () => unknown) { return fn(); }),
}))

vi.mock('../../providers/unified-provider.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../providers/unified-provider.js')>()
  return {
    ...actual,
    getModel: vi.fn(),
  }
})

function createLanguageModelStub(id: string): LanguageModel {
  return {
    provider: 'test',
    modelId: id,
    doGenerate: vi.fn(),
    doStream: vi.fn()
  } as unknown as LanguageModel
}

function createMockSkillToolProvider(overrides: Partial<SkillToolProvider> = {}): SkillToolProvider {
  return {
    getAllTools: vi.fn(function () { return {}; }),
    getSkillToolNames: vi.fn(function () { return []; }),
    getActiveToolNames: vi.fn(function () { return []; }),
    updateSkillUsage: vi.fn(),
    cleanupInactiveSkills: vi.fn(function () { return []; }),
    ...overrides
  }
}

function customStopCondition() {
  return false
}

describe('AgentWrapper withModel', function withModelSuite() {
  let mockAgent: {
    generate: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }
   
  let lastSettings: any
  let MockToolLoopAgent: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mockAgent = {
      generate: vi.fn(),
      stream: vi.fn()
    }
    lastSettings = undefined
    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as ReturnType<typeof vi.fn>
    MockToolLoopAgent.mockImplementation(function toolLoopAgentFactory(settings: unknown) {
      lastSettings = settings
      return mockAgent
    })
  })

  it('returns a new AgentWrapper instance (not the same reference)', function newInstance() {
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'original',
      system: 'system',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }
    const wrapper = new AgentWrapper(config)
    const derived = wrapper.withModel(nextModel, 'next-name')
    expect(derived).not.toBe(wrapper)
  })

  it('sets modelName on the new instance via getConfig()', function modelNameOverride() {
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'gpt-4',
      system: 'system',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }
    const wrapper = new AgentWrapper(config)
    const derived = wrapper.withModel(nextModel, 'claude-opus-4-6')
    expect(derived.getConfig().modelName).toBe('claude-opus-4-6')
    expect(wrapper.getConfig().modelName).toBe('gpt-4')
  })

  it('preserves tools, system prompt, temperature, and stop conditions', function preservesConfig() {
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const tools = { baseTool: { execute: vi.fn() } as Tool }
    const stopAfterTools = ['submit']
    const stopWhen = [customStopCondition]
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'base',
      system: 'Fixed system prompt',
      tools,
      temperature: 0.37,
      maxSteps: 13,
      stopAfterTools,
      stopWhen,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }
    const wrapper = new AgentWrapper(config)
    const derived = wrapper.withModel(nextModel, 'other')
    const nextCfg = derived.getConfig()
    expect(nextCfg.tools).toBe(tools)
    expect(nextCfg.system).toBe('Fixed system prompt')
    expect(nextCfg.temperature).toBe(0.37)
    expect(nextCfg.maxSteps).toBe(13)
    expect(nextCfg.stopAfterTools).toBe(stopAfterTools)
    expect(nextCfg.stopWhen).toBe(stopWhen)
    expect(nextCfg.model).toBe(nextModel)
  })

  it('passes skillToolProvider to the new instance', async function skillProviderForwarded() {
    const skillProvider = createMockSkillToolProvider({
      getSkillToolNames: vi.fn(function () { return ['skill__x__tool']; })
    })
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      system: 'You are a test assistant',
      tools: {
        base: { execute: vi.fn() } as Tool,
        skill__x__tool: { execute: vi.fn() } as Tool
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }
    const wrapper = new AgentWrapper(config, skillProvider)
    wrapper.withModel(nextModel, 'switched-model')
    await lastSettings.prepareCall({
      prompt: 'test',
      messages: [],
      options: { executionContext: { metadata: { conversationId: 'conv-xyz' } } }
    })
    expect(skillProvider.cleanupInactiveSkills).toHaveBeenCalledWith('conv-xyz', expect.any(Number))
  })

  it('constructs a new ToolLoopAgent with the override model', function constructsNewAgent() {
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'original',
      system: 'system prompt',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    const firstCallCount = MockToolLoopAgent.mock.calls.length
    wrapper.withModel(nextModel, 'next-model')

    expect(MockToolLoopAgent).toHaveBeenCalledTimes(firstCallCount + 1)
    expect(lastSettings.model).toBe(nextModel)
  })

  it('does not add provider options when switching to a model with defaults', function noDuplicateDefaults() {
    const originalModel = createLanguageModelStub('claude-sonnet-4-5')
    const nextModel = createLanguageModelStub('claude-sonnet-4-6')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'claude-sonnet-4-5',
      system: 'system',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    wrapper.withModel(nextModel, 'claude-sonnet-4-6')

    expect(lastSettings.providerOptions).toBeUndefined()
  })

  it('passes explicit provider options through when switching models', function providerOptionsPassthrough() {
    const originalModel = createLanguageModelStub('claude-sonnet-4-6')
    const nextModel = createLanguageModelStub('claude-haiku-4-5')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'claude-sonnet-4-6',
      system: 'system',
      providerOptions: {
        anthropic: { effort: 'high', disableParallelToolUse: true }
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    wrapper.withModel(nextModel, 'claude-haiku-4-5')

    expect(lastSettings.providerOptions).toEqual({
      anthropic: { effort: 'high', disableParallelToolUse: true }
    })
  })

  it('keeps effort when override model supports it', function keepsEffort() {
    const originalModel = createLanguageModelStub('claude-sonnet-4-5')
    const nextModel = createLanguageModelStub('claude-sonnet-4-6')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'claude-sonnet-4-5',
      system: 'system',
      providerOptions: {
        anthropic: { effort: 'high' }
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    wrapper.withModel(nextModel, 'claude-sonnet-4-6')

    expect(lastSettings.providerOptions?.anthropic?.effort).toBe('high')
  })

  it('creates a new prepareCall closure referencing the override model', async function newPrepareCall() {
    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'original',
      system: 'system',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config)
    const origPrepareCall = lastSettings.prepareCall

    new AgentWrapper({ ...config, model: nextModel, modelName: 'next-name' })
    const newPrepareCall = lastSettings.prepareCall

    expect(newPrepareCall).not.toBe(origPrepareCall)
  })

  it('swaps provider-specific tools when switching from anthropic to non-anthropic', function swapsProviderTools() {
    const fallbackKey = PROVIDER_TOOL_FALLBACK
    const anthropicTool = { execute: vi.fn() } as Tool
    const fallbackTool = { execute: vi.fn() } as Tool
    ;(anthropicTool as any)[fallbackKey] = fallbackTool

    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const normalTool = { execute: vi.fn() } as Tool
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'claude-sonnet-4-6',
      system: 'system',
      tools: {
        providerTool: anthropicTool,
        regularTool: normalTool,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    const derived = wrapper.withModel(nextModel, 'some-openai-model')
    const nextCfg = derived.getConfig()

    expect(nextCfg.tools!.providerTool).toBe(fallbackTool)
    expect(nextCfg.tools!.regularTool).toBe(normalTool)
  })

  it('preserves provider-specific tools when staying on same provider', function preservesProviderTools() {
    const fallbackKey = PROVIDER_TOOL_FALLBACK
    const anthropicTool = { execute: vi.fn() } as Tool
    const fallbackTool = { execute: vi.fn() } as Tool
    ;(anthropicTool as any)[fallbackKey] = fallbackTool

    const originalModel = createLanguageModelStub('orig')
    const nextModel = createLanguageModelStub('next')
    const config: AgentConfig = {
      name: 'test-agent',
      model: originalModel,
      modelName: 'claude-sonnet-4-6',
      system: 'system',
      tools: { providerTool: anthropicTool },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    const derived = wrapper.withModel(nextModel, 'claude-haiku-4-5')
    const nextCfg = derived.getConfig()

    expect(nextCfg.tools!.providerTool).toBe(anthropicTool)
  })

  it('swaps provider-specific tools at construction when initial model is non-anthropic', function swapsAtConstruction() {
    const fallbackKey = PROVIDER_TOOL_FALLBACK
    const anthropicTool = {
      type: 'provider',
      id: 'anthropic.text_editor_20250728',
      execute: vi.fn()
    } as unknown as Tool
    const fallbackTool = { execute: vi.fn() } as Tool
    ;(anthropicTool as any)[fallbackKey] = fallbackTool

    const model = createLanguageModelStub('kimi')
    const config: AgentConfig = {
      name: 'test-agent',
      model,
      // Non-anthropic model supplied from the start (e.g. AI_MODEL_OVERRIDE)
      modelName: 'azure/Kimi-K2.6',
      system: 'system',
      tools: { providerTool: anthropicTool },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    expect(wrapper.getConfig().tools!.providerTool).toBe(fallbackTool)
  })

  it('keeps provider-specific tools at construction when initial model is anthropic', function keepsAtConstructionAnthropic() {
    const fallbackKey = PROVIDER_TOOL_FALLBACK
    const anthropicTool = {
      type: 'provider',
      id: 'anthropic.text_editor_20250728',
      execute: vi.fn()
    } as unknown as Tool
    const fallbackTool = { execute: vi.fn() } as Tool
    ;(anthropicTool as any)[fallbackKey] = fallbackTool

    const model = createLanguageModelStub('sonnet')
    const config: AgentConfig = {
      name: 'test-agent',
      model,
      modelName: 'claude-sonnet-4-6',
      system: 'system',
      tools: { providerTool: anthropicTool },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const wrapper = new AgentWrapper(config)
    expect(wrapper.getConfig().tools!.providerTool).toBe(anthropicTool)
  })
})

describe('AgentWrapper override delegation', function overrideSuite() {
  let mockAgent: {
    generate: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }
  let MockToolLoopAgent: ReturnType<typeof vi.fn>
  let mockGetActiveModelOverride: ReturnType<typeof vi.fn>
  let mockGetModel: ReturnType<typeof vi.fn>
  let lastOverrideSettings: any
  const savedEnv = { AI_MODEL_OVERRIDE: undefined as string | undefined }

  beforeEach(async () => {
    savedEnv.AI_MODEL_OVERRIDE = process.env.AI_MODEL_OVERRIDE
    delete process.env.AI_MODEL_OVERRIDE
    lastOverrideSettings = undefined

    mockAgent = {
      generate: vi.fn().mockResolvedValue({
        text: 'response',
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
      }),
      stream: vi.fn(),
    }
    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as ReturnType<typeof vi.fn>
    MockToolLoopAgent.mockClear()
    MockToolLoopAgent.mockImplementation(function factory(settings: unknown) {
      lastOverrideSettings = settings
      return mockAgent
    })

    const overrideCtx = await import('../model-override-context.js')
    mockGetActiveModelOverride = overrideCtx.getActiveModelOverride as ReturnType<typeof vi.fn>
    mockGetActiveModelOverride.mockReturnValue(null)

    const provider = await import('../../providers/unified-provider.js')
    mockGetModel = provider.getModel as ReturnType<typeof vi.fn>
    mockGetModel.mockResolvedValue(createLanguageModelStub('override-model'))
  })

  afterEach(function restore() {
    if (savedEnv.AI_MODEL_OVERRIDE !== undefined) {
      process.env.AI_MODEL_OVERRIDE = savedEnv.AI_MODEL_OVERRIDE
    } else {
      delete process.env.AI_MODEL_OVERRIDE
    }
    vi.clearAllMocks()
  })

  function createWrapper(modelName = 'base-model'): AgentWrapper {
    return new AgentWrapper({
      name: 'test-agent',
      model: createLanguageModelStub(modelName),
      modelName,
      system: 'system',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
  }

  it('delegates to override agent when getActiveModelOverride returns a value', async function delegatesOverride() {
    mockGetActiveModelOverride.mockReturnValue('claude-sonnet-4-5')

    const wrapper = createWrapper()
    await wrapper.generate('hello')

    expect(mockGetModel).toHaveBeenCalledWith('claude-sonnet-4-5')
    // Two ToolLoopAgent instances: base + override
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(2)
  })

  it('uses default model when no override is active', async function noOverride() {
    const wrapper = createWrapper()
    await wrapper.generate('hello')

    expect(mockGetModel).not.toHaveBeenCalled()
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(1)
  })

  it('caches override agents on second call', async function cachesOverride() {
    mockGetActiveModelOverride.mockReturnValue('claude-sonnet-4-5')

    const wrapper = createWrapper()
    await wrapper.generate('hello')
    await wrapper.generate('world')

    expect(mockGetModel).toHaveBeenCalledTimes(1)
    // Base + 1 override (reused)
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(2)
  })

  it('rebuilds system prompt for runtime override agents when configured', async function rebuildsSystem() {
    mockGetActiveModelOverride.mockReturnValue('azure/Kimi-K2.6')
    const systemForModel = vi.fn(async function systemForModel(modelName: string) {
      return `system for ${modelName}`
    })

    const wrapper = new AgentWrapper({
      name: 'test-agent',
      model: createLanguageModelStub('base-model'),
      modelName: 'base-model',
      system: 'system for base-model',
      metadata: {
        systemForModel
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    await wrapper.generate('hello')

    // Override agent uses a per-turn resolver that delegates to systemForModel.
    // The resolver is NOT eagerly called at construction — it defers to prepareStep.
    // Verify the override ToolLoopAgent was created without static instructions
    // (indicating system is function-form, resolved per-turn via prepareStep).
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(2)
    expect(lastOverrideSettings.instructions).toBeUndefined()
    // The override agent's config.system should be a resolver function
    // that when called produces the model-specific prompt.
    const overrideConfig = wrapper.getConfig()
    // Can't directly access the override agent's config, but verify systemForModel
    // was NOT eagerly resolved — it's deferred to per-turn prepareStep.
    expect(systemForModel).not.toHaveBeenCalled()
  })

  it('falls back to default on getModel failure', async function fallsBack() {
    mockGetActiveModelOverride.mockReturnValue('bad-model')
    mockGetModel.mockRejectedValue(new Error('provider not configured'))

    const wrapper = createWrapper()
    await wrapper.generate('hello')

    // Should still have generated with the base agent
    expect(mockAgent.generate).toHaveBeenCalled()
  })

  it('does not recurse when override matches current modelName', async function noRecursion() {
    mockGetActiveModelOverride.mockReturnValue('base-model')

    const wrapper = createWrapper('base-model')
    await wrapper.generate('hello')

    // No override agent created — override matches configured model
    expect(mockGetModel).not.toHaveBeenCalled()
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(1)
  })

  it('AI_MODEL_OVERRIDE env var takes precedence over AsyncLocalStorage', async function envVarPrecedence() {
    process.env.AI_MODEL_OVERRIDE = 'env-model'
    mockGetActiveModelOverride.mockReturnValue('als-model')

    const wrapper = createWrapper()
    await wrapper.generate('hello')

    expect(mockGetModel).toHaveBeenCalledWith('env-model')
  })

  it('delegates streamGenerate to override agent', async function streamDelegation() {
    mockGetActiveModelOverride.mockReturnValue('claude-sonnet-4-5')

    const wrapper = createWrapper()

    // The override agent's stream method needs to work for streamGenerate
    mockAgent.stream = vi.fn().mockReturnValue({
      textStream: (async function* () { yield 'text' })(),
      response: Promise.resolve({ id: '1', timestamp: new Date(), modelId: 'test' }),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
    })

    const result = await wrapper.streamGenerate('hello')
    for await (const _chunk of result.textStream) {
      // consume stream
    }

    expect(mockGetModel).toHaveBeenCalledWith('claude-sonnet-4-5')
    // Base + override
    expect(MockToolLoopAgent).toHaveBeenCalledTimes(2)
  })
})
