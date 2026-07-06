import { describe, it, expect, vi } from 'vitest'
import { createDeepBuildAgent } from '../deep-build-agent.js'

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'claude-sonnet-4-6'
  })
}))

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib')
  const { createMockPromptBuilder } = await import('./helpers/mock-prompt-builder.js')
  return {
    ...actual,
    createPromptBuilder: () =>
      createMockPromptBuilder({ buildResult: '# Deep Build\nYou are the orchestrator.' })
  }
})

describe('createDeepBuildAgent', () => {
  it('returns an AgentConfig with correct id and tools', async () => {
    const config = await createDeepBuildAgent()
    expect(config.id).toBe('deep-build')
    expect(config.name).toBe('Deep Build')
    expect(config.tools).toHaveProperty('askQuestion')
    expect(config.tools).toHaveProperty('runAgent')
    expect(config.tools).toHaveProperty('awaitAgents')
    expect(config.tools).toHaveProperty('setAgentMode')
    expect(config.tools).toHaveProperty('workflow')
    expect(config.tools).not.toHaveProperty('todoList')
    expect(config.tools).toHaveProperty('showDoc')
    expect(config.tools).toHaveProperty('readFile')
    expect(config.tools).toHaveProperty('str_replace_based_edit_tool')
    expect(config.tools).not.toHaveProperty('skill')
    expect(config.tools).not.toHaveProperty('reference')
  })

  it('has stop-after on askQuestion', async () => {
    const config = await createDeepBuildAgent()
    expect(config.stopAfterTools).toContain('askQuestion')
  })
})
