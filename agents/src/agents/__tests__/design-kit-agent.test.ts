import { describe, it, expect, vi } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

// Mock model selection so the test does not depend on real model/provider config.
vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet',
  }),
}))

// Mock the prompt builder + handoff tool so prompt assembly is hermetic.
vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  const { createMockPromptBuilder } = await import('./helpers/mock-prompt-builder.js')
  return {
    ...actual,
    createPromptBuilder: () =>
      createMockPromptBuilder({
        buildResult: '# Design Kit Wizard\nYou drive the brand wizard.',
      }),
    createHandoffTool: vi.fn().mockReturnValue({ execute: vi.fn() }),
  }
})

// Mock fs so the design-kit manifest resolves without requiring the real
// prompt files to exist on disk. Mirrors initial-design-system-config.test.ts.
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    existsSync: (path: string) => {
      if (path.includes('initial/design-kit/manifest.json')) return true
      if (path.includes('initial/design-kit/')) return true
      if (path.includes('initial/3.0/manifest.json')) return false
      if (path.includes('initial/3.0/')) return true
      if (path.includes('initial/1.0/manifest.json')) return false
      if (path.includes('core.md')) return true
      return false
    },
    readFileSync: (path: string, encoding?: string) => {
      if (typeof path === 'string' && path.includes('initial/design-kit/manifest.json')) {
        return JSON.stringify({
          base: '3.0',
          preflightTools: ['listDesignSystems'],
          files: [
            { src: 'base', file: 'identity.md' },
            { src: 'variant', file: 'questioning-phase1.md' },
            { src: 'variant', file: 'wizard-flow.md' },
            { src: 'variant', file: 'brand-showcase.md' },
          ],
        })
      }
      return (actual as any).readFileSync(path, encoding)
    },
  }
})

describe('createInitialAgent (design-kit wizard variant)', () => {
  it('builds with id initial-design-kit and registers the wizard tools', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-kit')

    // id is the real AgentConfig property; the design-kit promptVersion derives
    // a named-variant id of `initial-design-kit`.
    expect(cfg.id).toContain('design-kit')
    expect(cfg.id).toBe('initial-design-kit')

    // tools is the real AgentConfig property (Record<string, unknown>).
    expect(cfg.tools.setWizardStep).toBeDefined()
    expect(cfg.tools.installDesignSystem).toBeDefined()
  })

  it('wires the full design-kit tool set', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-kit')

    expect(cfg.tools).toHaveProperty('listDesignSystems')
    expect(cfg.tools).toHaveProperty('installDesignSystem')
    // Vibe picker (AIROBUILD-2854): presents the top kit matches as preview cards.
    expect(cfg.tools).toHaveProperty('suggestDesignKits')
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect(cfg.tools).toHaveProperty('colorScheme')
    expect(cfg.tools).toHaveProperty('fontTheme')
    expect(cfg.tools).toHaveProperty('brand')
    expect(cfg.tools).toHaveProperty('skill')
    expect(cfg.tools).toHaveProperty('media')
    expect(cfg.tools).toHaveProperty('setWizardStep')
    // The file editor stays wired for ad-hoc refinements (e.g. the user asks to tweak a
    // specific file mid-wizard) so the agent edits directly rather than improvising (it was
    // once seen trying to load a nonexistent "file-edit" skill). The homepage and brand
    // showcase are built by sub-agents (design-kit-build + builder), not the wizard itself.
    expect(cfg.tools).toHaveProperty('str_replace_based_edit_tool')
    // AIROBUILD-2871: the wizard fans out the website build to a background `builder`
    // sub-agent, so it needs the sub-agent dispatch tools.
    expect(cfg.tools).toHaveProperty('runAgent')
    expect(cfg.tools).toHaveProperty('awaitAgents')

    // The wizard uses the consolidated, design-kit-owned `brand` tool — NOT the
    // shared brandBook or the raw memory tools (keeps it isolated from production).
    expect(cfg.tools).not.toHaveProperty('brandBook')
    expect(cfg.tools).not.toHaveProperty('memorySet')
    expect(cfg.tools).not.toHaveProperty('memoryRead')

    // websiteRebuild performs an unconditional switchAgent(...,'develop') with no
    // step gating; it must NOT be wired for the wizard or it could hand off to
    // develop mid-flow instead of taking the parallel fan-out route.
    expect(cfg.tools).not.toHaveProperty('websiteRebuild')
  })

  it('stops after suggestDesignKits so the agent yields to the vibe picker', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-kit')

    // Without this, the assembly turn (designed to fire many tools in sequence)
    // would barrel past the kit cards and auto-install, defeating the picker.
    expect(cfg.stopAfterTools).toContain('suggestDesignKits')
  })

  it('withholds the handoff tool for the wizard even with a stateManager, and wires fan-out instead (AIROBUILD-2871)', async () => {
    // A real stateManager makes the handoff tool available; the wizard must still NOT
    // wire it (it builds the website via a background builder, not a develop handoff).
    const stateManager = {} as Parameters<typeof createInitialAgent>[0]

    const designKit = await createInitialAgent(stateManager, undefined, 'design-kit')
    expect(designKit.tools).not.toHaveProperty('handoff')
    expect(designKit.tools).toHaveProperty('runAgent')
    expect(designKit.tools).toHaveProperty('awaitAgents')

    // Control: the default variant still gets the handoff tool when a stateManager is present.
    const def = await createInitialAgent(stateManager)
    expect(def.tools).toHaveProperty('handoff')
    expect(def.tools).not.toHaveProperty('runAgent')
  })

  it('does not wire the wizard stepper or suggestDesignKits for the default variant', async () => {
    const cfg = await createInitialAgent()

    expect(cfg.id).toBe('initial')
    expect(cfg.tools).not.toHaveProperty('setWizardStep')
    expect(cfg.tools).not.toHaveProperty('suggestDesignKits')
    expect(cfg.stopAfterTools ?? []).not.toContain('suggestDesignKits')
  })
})
