import { describe, it, expect, vi } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'
import { UI_KIT_COLOR_CONTRAST_GUARDRAIL } from '../../prompts/ui-kit-guardrail.js'

vi.mock('../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    registerSkill: vi.fn().mockReturnValue({ success: true }),
    unloadSkill: vi.fn(),
    runHook: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../tools/skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn().mockImplementation(function skillLoaderToolMock() {
    return { loadSkill: vi.fn().mockResolvedValue({ success: true, instructions: '' }) }
  }),
}))

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet',
  }),
}))

async function buildSystemPrompt(version: string): Promise<string> {
  const config = await createInitialAgent(undefined, undefined, version)
  const system: unknown = config.system
  return typeof system === 'function'
    ? await (system as (ctx: Record<string, unknown>) => Promise<string>)({})
    : (system as string)
}

describe('design-system-homepage-build color/contrast guardrail (AIROBUILD-3143)', () => {
  it('auto-select variant folds the shared guardrail into the initial prompt', async () => {
    // The auto-select build installs the kit mid-stream, so the per-turn kit
    // anchor (gated on kitMetaExists) misses this first turn — the prompt itself
    // must carry the guardrail so the initial homepage is contrast-safe.
    const prompt: string = await buildSystemPrompt('design-system-homepage-build')
    expect(prompt).toContain(UI_KIT_COLOR_CONTRAST_GUARDRAIL)
  })

  it('attached variant does not duplicate it (covered by the turn-1 anchor)', async () => {
    // The attached path force-installs the kit before the agent loop, so
    // kitMetaExists is true and the anchor already injects the guardrail on
    // turn 1; folding it into the prompt too would be redundant.
    const prompt: string = await buildSystemPrompt('design-system-homepage-build-attached')
    expect(prompt).not.toContain(UI_KIT_COLOR_CONTRAST_GUARDRAIL)
  })

  it('non-kit / default (3.0) prompt does NOT contain the guardrail (scoping guard)', async () => {
    // Hard constraint (AIROBUILD-3143): the color/contrast guardrail must never
    // leak into non-design-kit builds. Locks the exact `=== 'design-system-homepage-build'`
    // gate against a future widening (e.g. startsWith) that would affect every build.
    const prompt: string = await buildSystemPrompt('3.0')
    expect(prompt).not.toContain(UI_KIT_COLOR_CONTRAST_GUARDRAIL)
  })
})
