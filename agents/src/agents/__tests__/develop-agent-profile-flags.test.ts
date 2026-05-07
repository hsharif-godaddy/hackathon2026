import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runWithProfile } from '../../profiles/index.js'
import type { ProfileData } from '../../profiles/types.js'

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { generate: vi.fn(), streamGenerate: vi.fn() },
    modelName: 'claude-sonnet-4-6'
  })
}))

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises')
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('')
  }
})

/**
 * Track which file paths are passed to promptBuilder.file() so we can assert
 * whether profile-gated prompt sections are included or excluded.
 */
let loadedFiles: string[] = []

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib')
  const mockBuilder = () => {
    const self: Record<string, any> = {}
    self.file = vi.fn().mockImplementation((path: string) => {
      loadedFiles.push(path)
      return self
    })
    self.text = vi.fn().mockReturnValue(self)
    self.template = vi.fn().mockReturnValue(self)
    self.build = vi.fn().mockResolvedValue('# AI Developer\nYou are a senior web developer.')
    return self
  }
  return {
    ...actual,
    createPromptBuilder: mockBuilder,
    createHandoffTool: vi.fn().mockReturnValue({
      execute: vi.fn()
    })
  }
})

// Must import after mocks are defined
const { createDevelopAgent } = await import('../develop-agent.js')

describe('develop-agent profile flag gating', () => {
  beforeEach(() => {
    loadedFiles = []
  })

  describe('default (no active profile)', () => {
    it('includes askQuestion tool (promptOptimization defaults true)', async () => {
      const config = await createDevelopAgent()
      expect(config.tools).toHaveProperty('askQuestion')
    })

    it('does not include suggestedResponse tool (defaults false)', async () => {
      const config = await createDevelopAgent()
      expect(config.tools).not.toHaveProperty('suggestedResponse')
    })

    it('sets stopAfterTools containing askQuestion', async () => {
      const config = await createDevelopAgent()
      expect(config.stopAfterTools).toContain('askQuestion')
    })

    it('loads prompt-optimization.md', async () => {
      await createDevelopAgent()
      const hasPromptOpt = loadedFiles.some(f => f.includes('prompt-optimization.md'))
      expect(hasPromptOpt).toBe(true)
    })

    it('does not load suggested-response.md', async () => {
      await createDevelopAgent()
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasSuggestedResponse).toBe(false)
    })
  })

  describe('develop.promptOptimization=false (opt out)', () => {
    const profile: ProfileData = {
      name: 'test-no-prompt-opt',
      description: 'test profile disabling prompt optimization',
      properties: { 'develop.promptOptimization': false }
    }

    it('does not include askQuestion tool', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.tools).not.toHaveProperty('askQuestion')
    })

    it('does not set stopAfterTools', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.stopAfterTools).toBeUndefined()
    })

    it('does not load prompt-optimization.md', async () => {
      await runWithProfile(profile, () => createDevelopAgent())
      const hasPromptOpt = loadedFiles.some(f => f.includes('prompt-optimization.md'))
      expect(hasPromptOpt).toBe(false)
    })
  })

  describe('develop.suggestedResponse=true (opt in)', () => {
    const profile: ProfileData = {
      name: 'test-with-sr',
      description: 'test profile enabling suggested response',
      properties: { 'develop.suggestedResponse': true }
    }

    it('includes suggestedResponse tool', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.tools).toHaveProperty('suggestedResponse')
    })

    it('loads suggested-response.md', async () => {
      await runWithProfile(profile, () => createDevelopAgent())
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasSuggestedResponse).toBe(true)
    })
  })

  describe('develop.suggestedResponse=false (explicit)', () => {
    const profile: ProfileData = {
      name: 'test-no-sr',
      description: 'test profile explicitly disabling suggested response',
      properties: { 'develop.suggestedResponse': false }
    }

    it('does not include suggestedResponse tool', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.tools).not.toHaveProperty('suggestedResponse')
    })

    it('does not load suggested-response.md', async () => {
      await runWithProfile(profile, () => createDevelopAgent())
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasSuggestedResponse).toBe(false)
    })
  })

  describe('both flags: promptOptimization=false, suggestedResponse=true', () => {
    const profile: ProfileData = {
      name: 'test-legacy',
      description: 'test profile reverting to legacy behavior',
      properties: {
        'develop.promptOptimization': false,
        'develop.suggestedResponse': true
      }
    }

    it('does not include askQuestion tool', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.tools).not.toHaveProperty('askQuestion')
    })

    it('includes suggestedResponse tool', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.tools).toHaveProperty('suggestedResponse')
    })

    it('does not set stopAfterTools', async () => {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      expect(config.stopAfterTools).toBeUndefined()
    })

    it('does not load prompt-optimization.md but loads suggested-response.md', async () => {
      await runWithProfile(profile, () => createDevelopAgent())
      const hasPromptOpt = loadedFiles.some(f => f.includes('prompt-optimization.md'))
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasPromptOpt).toBe(false)
      expect(hasSuggestedResponse).toBe(true)
    })
  })
})
