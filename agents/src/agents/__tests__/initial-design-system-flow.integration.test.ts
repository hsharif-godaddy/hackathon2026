import { describe, it, expect, vi } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

// Stub only model initialisation — no API key available in CI.
// All prompt-file loading uses the real filesystem.
vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'sonnet',
  }),
}))

describe('initial-design-system prompt assembly', () => {
  it('includes the variant modules + 3.0 base modules', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'design-system')
    const sys = cfg.system as string
    // 3.0 base content (identity.md from base)
    expect(sys).toContain('Initial Agent')
    // Variant module
    expect(sys).toContain('Design System Auto-Selection')
  })
})
