import { describe, it, expect, vi, type MockInstance } from 'vitest'

// Mock allAILibTools to avoid transitive import of @airo/shared/fonts
// which is a pre-existing missing subpath export in the test environment.
vi.mock('../../../tools/ai-lib-tools/index.js', () => ({
  allAILibTools: new Proxy(
    {},
    {
      get(_target: Record<string, unknown>, key: string) {
        return { name: key }
      },
    }
  ),
}))

// Shared text spy — reassigned before the third test so we can inspect calls
// scoped to a single createPlanningConfig invocation.
let capturedTextSpy: MockInstance | null = null

// Mock createPromptBuilder to avoid loading prompt files from disk.
// The factory is a vi.fn() so it IS a spy; each call stores the text spy for inspection.
vi.mock('@airo/ai-lib', () => ({
  createPromptBuilder: vi.fn(() => {
    const textSpy = vi.fn()
    capturedTextSpy = textSpy
    return {
      file: vi.fn(),
      text: textSpy,
      build: vi.fn().mockResolvedValue('mocked system prompt'),
    }
  }),
}))

// Mock getModularPromptPaths
vi.mock('../../../utils/prompt-utils.js', () => ({
  getModularPromptPaths: () => ({
    getAgentFile: (_dir: string, _file: string) => '/mock/path',
  }),
}))

// Mock resolveTemplateContext so tests are deterministic and don't touch the filesystem.
// Returns a non-empty string by default so the `if (templateContext)` guard passes in all tests.
vi.mock('../../template-context.js', () => ({
  resolveTemplateContext: vi.fn().mockResolvedValue('Stack Overview — fake corpus body'),
}))

import { createPlanningConfig } from '../planning.js'
import { createBuilderConfig } from '../builder.js'
import { createDiscoveryConfig } from '../discovery.js'
import { createMediaConfig } from '../media.js'
import { createDesignConfig } from '../design.js'
import { createPlanReviewConfig } from '../plan-review.js'

describe('reference tool wiring', () => {
  it('planning/builder/discovery/media/plan-review expose the reference tool', async () => {
    for (const factory of [createPlanningConfig, createBuilderConfig, createDiscoveryConfig, createMediaConfig, createPlanReviewConfig]) {
      const cfg = await factory()
      expect(cfg.tools.reference).toBeDefined()
    }
  })

  it('design does NOT expose the reference tool', async () => {
    const cfg = await createDesignConfig()
    expect(cfg.tools.reference).toBeUndefined()
  })

  it('planning injects the corpus summary as ground truth', async () => {
    // Reset so capturedTextSpy reflects only this invocation.
    capturedTextSpy = null

    await createPlanningConfig()

    // The mock factory assigns capturedTextSpy when createPromptBuilder() is called
    // inside createPlanningConfig. It must have been called.
    expect(capturedTextSpy).not.toBeNull()
    const textSpy = capturedTextSpy!

    // The injection glue in planning.ts wraps templateContext with a preamble and
    // calls promptBuilder.text(). If the `if (templateContext) { promptBuilder.text(...) }`
    // block were removed, textSpy would NOT have been called and both assertions fail.
    expect(textSpy).toHaveBeenCalledWith(expect.stringContaining('Reference Documentation (Ground Truth)'))
    expect(textSpy).toHaveBeenCalledWith(expect.stringContaining('Stack Overview — fake corpus body'))
  })
})
