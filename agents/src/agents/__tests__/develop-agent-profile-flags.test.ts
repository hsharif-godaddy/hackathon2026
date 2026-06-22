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
 * whether profile-gated prompt sections are included or excluded when the
 * system resolver fires.
 */
let loadedFiles: string[] = []

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual('@airo/ai-lib')
  const mockBuilder = () => {
    const self: Record<string, any> = {}
    self.file = vi.fn().mockImplementation(function (path: string) {
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

/**
 * Build the agent config and immediately invoke the system + activeTools
 * resolvers under the given profile, returning the materialized prompt files
 * + active tool list. Mirrors how AgentWrapper invokes these inside prepareCall.
 */
async function resolveUnderProfile(profile: ProfileData | undefined) {
  const config = await createDevelopAgent()
  const fn = profile
    ? (cb: () => Promise<void>) => runWithProfile(profile, cb)
    : (cb: () => Promise<void>) => cb()
  let activeTools: string[] = []
  await fn(async () => {
    if (typeof config.system === 'function') {
      await config.system({})
    }
    if (typeof config.activeTools === 'function') {
      activeTools = await config.activeTools({})
    }
  })
  return { config, activeTools }
}

describe('develop-agent profile flag gating (resolver-driven)', () => {
  beforeEach(() => {
    loadedFiles = []
  })

  describe('default (no active profile)', () => {
    it('exposes askQuestion via activeTools (promptOptimization defaults true)', async () => {
      const { activeTools } = await resolveUnderProfile(undefined)
      expect(activeTools).toContain('askQuestion')
    })

    it('hides suggestedResponse via activeTools (defaults false)', async () => {
      const { activeTools } = await resolveUnderProfile(undefined)
      expect(activeTools).not.toContain('suggestedResponse')
    })

    it('always lists askQuestion in stopAfterTools (union; inert when not active)', async () => {
      const config = await createDevelopAgent()
      expect(config.stopAfterTools).toContain('askQuestion')
    })

    it('keeps both askQuestion and suggestedResponse in the tools map (union)', async () => {
      // The tools map is the union across profiles; per-turn visibility is
      // controlled by activeTools, not by removing entries from the map.
      const config = await createDevelopAgent()
      expect(config.tools).toHaveProperty('askQuestion')
      expect(config.tools).toHaveProperty('suggestedResponse')
    })

    it('loads prompt-optimization.md when system resolver fires', async () => {
      await resolveUnderProfile(undefined)
      const hasPromptOpt = loadedFiles.some(f => f.includes('prompt-optimization.md'))
      expect(hasPromptOpt).toBe(true)
    })

    it('does not load suggested-response.md', async () => {
      await resolveUnderProfile(undefined)
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasSuggestedResponse).toBe(false)
    })
  })

  describe('develop.contentSystem (content_scaffold gating)', () => {
    it('hides content_scaffold via activeTools by default (defaults false)', async () => {
      const { activeTools } = await resolveUnderProfile(undefined)
      expect(activeTools).not.toContain('content_scaffold')
    })

    it('exposes content_scaffold via activeTools when the flag is set', async () => {
      const profile: ProfileData = {
        name: 'test-content-system',
        description: 'test profile enabling the content system',
        properties: { 'develop.contentSystem': true }
      }
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).toContain('content_scaffold')
    })

    it('keeps content_scaffold in the tools map (union; inert when not active)', async () => {
      const config = await createDevelopAgent()
      expect(config.tools).toHaveProperty('content_scaffold')
    })

    it('does not load content-layer.md by default (defaults false)', async () => {
      await resolveUnderProfile(undefined)
      const hasContentLayer = loadedFiles.some(f => f.includes('content-layer.md'))
      expect(hasContentLayer).toBe(false)
    })

    it('loads content-layer.md when the flag is set', async () => {
      const profile: ProfileData = {
        name: 'test-content-system',
        description: 'test profile enabling the content system',
        properties: { 'develop.contentSystem': true }
      }
      await resolveUnderProfile(profile)
      const hasContentLayer = loadedFiles.some(f => f.includes('content-layer.md'))
      expect(hasContentLayer).toBe(true)
    })
  })

  describe('develop.promptOptimization=false (opt out)', () => {
    const profile: ProfileData = {
      name: 'test-no-prompt-opt',
      description: 'test profile disabling prompt optimization',
      properties: { 'develop.promptOptimization': false }
    }

    it('hides askQuestion via activeTools', async () => {
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).not.toContain('askQuestion')
    })

    it('does not load prompt-optimization.md', async () => {
      await resolveUnderProfile(profile)
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

    it('exposes suggestedResponse via activeTools', async () => {
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).toContain('suggestedResponse')
    })

    it('loads suggested-response.md', async () => {
      await resolveUnderProfile(profile)
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

    it('hides suggestedResponse via activeTools', async () => {
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).not.toContain('suggestedResponse')
    })

    it('does not load suggested-response.md', async () => {
      await resolveUnderProfile(profile)
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

    it('hides askQuestion via activeTools', async () => {
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).not.toContain('askQuestion')
    })

    it('exposes suggestedResponse via activeTools', async () => {
      const { activeTools } = await resolveUnderProfile(profile)
      expect(activeTools).toContain('suggestedResponse')
    })

    it('does not load prompt-optimization.md but loads suggested-response.md', async () => {
      await resolveUnderProfile(profile)
      const hasPromptOpt = loadedFiles.some(f => f.includes('prompt-optimization.md'))
      const hasSuggestedResponse = loadedFiles.some(f => f.includes('suggested-response.md'))
      expect(hasPromptOpt).toBe(false)
      expect(hasSuggestedResponse).toBe(true)
    })
  })

  // Eval-prompt-variant wiring into buildDevelopSystemPrompt. The resolution
  // rules (fail-closed, replace-any-fragment, allow-list) are unit-tested in
  // develop-prompt-variants.test.ts; here we assert the builder is inert by
  // default and that an active variant flows through end to end. Fragments load
  // when the system resolver fires, so assert via resolveUnderProfile.
  describe('eval prompt variant wiring', () => {
    it('injects no variant fragment and keeps canonical core.md with no active profile', async () => {
      await resolveUnderProfile(undefined)
      const hasVariant = loadedFiles.some(f => f.includes('/experiments/'))
      const hasCanonicalCore = loadedFiles.some(
        f => f.includes('develop/core.md') && !f.includes('/experiments/')
      )
      expect(hasVariant).toBe(false)
      expect(hasCanonicalCore).toBe(true)
    })

    it('injects the example append variant when its flag is set on the active profile', async () => {
      // example-develop is intentionally NOT in the shipped registry; the flag
      // is set directly here to exercise the builder wiring for the variant
      // table's example row (example-arm.md ships, so the existsSync guard passes).
      const profile: ProfileData = {
        name: 'test-example-variant',
        description: 'test profile enabling the example eval prompt variant',
        properties: { 'develop.exampleArm': true }
      }
      await resolveUnderProfile(profile)
      const hasExampleArm = loadedFiles.some(f => f.includes('experiments/example-arm.md'))
      expect(hasExampleArm).toBe(true)
    })
  })
})
