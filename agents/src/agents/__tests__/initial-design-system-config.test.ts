import { describe, it, expect, vi } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet',
  }),
}))

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib')
  return {
    ...actual,
    createPromptBuilder: () => {
      const builder = {
        file: vi.fn().mockImplementation((_path: string) => builder),
        build: vi.fn().mockResolvedValue('# Design System Agent\nYou help users build with a design system.'),
      }
      return builder
    },
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

  it('does not wire design-system tools for the default variant', async () => {
    const cfg = await createInitialAgent()
    expect(cfg.tools).not.toHaveProperty('listDesignSystems')
    expect(cfg.tools).not.toHaveProperty('installDesignSystem')
  })
})
