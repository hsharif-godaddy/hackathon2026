import { describe, it, expect, vi } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet',
  }),
}))

vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  const { createMockPromptBuilder } = await import('./helpers/mock-prompt-builder.js')
  return {
    ...actual,
    createPromptBuilder: () =>
      createMockPromptBuilder({
        buildResult: '# Design System Agent\nYou help users build with a design system.',
      }),
    createHandoffTool: vi.fn().mockReturnValue({ execute: vi.fn() }),
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    existsSync: (path: string) => {
      if (path.includes('initial/design-system/manifest.json')) return true
      if (path.includes('initial/design-system/')) return true
      if (path.includes('initial/design-system-homepage-build-attached/manifest.json')) return true
      if (path.includes('initial/design-system-homepage-build-attached/')) return true
      if (path.includes('initial/design-system-homepage-build/manifest.json')) return true
      if (path.includes('initial/design-system-homepage-build/')) return true
      if (path.includes('initial/3.0/manifest.json')) return false
      if (path.includes('initial/3.0/')) return true
      if (path.includes('initial/1.0/manifest.json')) return false
      if (path.includes('core.md')) return true
      return false
    },
    readFileSync: (path: string, encoding?: string) => {
      if (typeof path === 'string' && path.includes('initial/design-system/manifest.json')) {
        return JSON.stringify({
          base: '3.0',
          preflightTools: ['listDesignSystems'],
          files: [
            { src: 'base', file: 'identity.md' },
            { src: 'variant', file: 'questioning-phase1.md' },
            { src: 'variant', file: 'auto-select.md' },
          ],
        })
      }
      if (typeof path === 'string' && path.includes('initial/design-system-homepage-build-attached/manifest.json')) {
        return JSON.stringify({
          base: '3.0',
          preflightTools: [],
          files: [
            { src: 'base', file: 'identity.md' },
            { src: 'variant', file: 'questioning-phase1.md' },
            { src: 'variant', file: 'use-attached-kit.md' },
          ],
        })
      }
      if (typeof path === 'string' && path.includes('initial/design-system-homepage-build/manifest.json')) {
        return JSON.stringify({
          base: '3.0',
          preflightTools: ['listDesignSystems'],
          files: [
            { src: 'base', file: 'identity.md' },
            { src: 'variant', file: 'questioning-phase1.md' },
            { src: 'variant', file: 'auto-select.md' },
          ],
        })
      }
      return (actual as any).readFileSync(path, encoding)
    },
  }
})

describe('createInitialAgent (design-system variant)', () => {
  it('wires listDesignSystems + installDesignSystem + loadUiKit and declares preflightTools', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-system')
    expect(cfg.id).toBe('initial-design-system')
    expect(cfg.tools).toHaveProperty('listDesignSystems')
    expect(cfg.tools).toHaveProperty('installDesignSystem')
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect((cfg.metadata as any).preflightTools).toContain('listDesignSystems')
  })

  it('wires design-system tools for the design-system-homepage-build variant', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-system-homepage-build')
    expect(cfg.id).toBe('initial-design-system-homepage-build')
    expect(cfg.tools).toHaveProperty('listDesignSystems')
    expect(cfg.tools).toHaveProperty('installDesignSystem')
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect((cfg.metadata as any).preflightTools).toContain('listDesignSystems')
  })

  it('omits select tools for the -attached fork but keeps loadUiKit/colorScheme/fontTheme', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-system-homepage-build-attached')
    expect(cfg.id).toBe('initial-design-system-homepage-build-attached')
    // SELECT tools dropped — the kit is force-installed; the agent must not re-pick.
    expect(cfg.tools).not.toHaveProperty('listDesignSystems')
    expect(cfg.tools).not.toHaveProperty('installDesignSystem')
    // colorScheme/fontTheme stay wired (on every variant) — when a kit is attached
    // their EXECUTION is locked in the tools, which covers every turn/variant; we
    // do NOT rely on per-variant tool removal (the build runs base turns too).
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect(cfg.tools).toHaveProperty('colorScheme')
    expect(cfg.tools).toHaveProperty('fontTheme')
    // No preflight: the forced-install path runs loadUiKit, so preflight must be empty.
    expect((cfg.metadata as any).preflightTools).toEqual([])
  })

  it('does not wire design-system tools for the default variant', async () => {
    const cfg = await createInitialAgent()
    expect(cfg.tools).not.toHaveProperty('listDesignSystems')
    expect(cfg.tools).not.toHaveProperty('installDesignSystem')
  })
})
