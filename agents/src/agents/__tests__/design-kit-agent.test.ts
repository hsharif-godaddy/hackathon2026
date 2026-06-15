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
  return {
    ...actual,
    createPromptBuilder: () => {
      const builder = {
        file: vi.fn().mockImplementation(function (_path: string) {
          return builder
        }),
        build: vi.fn().mockResolvedValue('# Design Kit Wizard\nYou drive the brand wizard.'),
      }
      return builder
    },
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
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect(cfg.tools).toHaveProperty('colorScheme')
    expect(cfg.tools).toHaveProperty('fontTheme')
    expect(cfg.tools).toHaveProperty('brand')
    expect(cfg.tools).toHaveProperty('skill')
    expect(cfg.tools).toHaveProperty('media')
    expect(cfg.tools).toHaveProperty('setWizardStep')
    // Step 4 authors public/brand-showcase.html itself — it must have the file editor,
    // or the agent improvises (it was seen trying to load a nonexistent "file-edit" skill).
    expect(cfg.tools).toHaveProperty('str_replace_based_edit_tool')

    // The wizard uses the consolidated, design-kit-owned `brand` tool — NOT the
    // shared brandBook or the raw memory tools (keeps it isolated from production).
    expect(cfg.tools).not.toHaveProperty('brandBook')
    expect(cfg.tools).not.toHaveProperty('memorySet')
    expect(cfg.tools).not.toHaveProperty('memoryRead')

    // websiteRebuild performs an unconditional switchAgent(...,'develop') with no
    // step gating; it must NOT be wired for the wizard or it could hand off to
    // develop mid-flow, before the Step-5 "Create my website" handoff.
    expect(cfg.tools).not.toHaveProperty('websiteRebuild')
  })

  it('does not wire the wizard stepper for the default variant', async () => {
    const cfg = await createInitialAgent()

    expect(cfg.id).toBe('initial')
    expect(cfg.tools).not.toHaveProperty('setWizardStep')
  })
})
