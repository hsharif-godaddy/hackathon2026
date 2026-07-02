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
import { createDesignKitBuildConfig } from '../design-kit-build.js'
import { createTaskWorkerConfig } from '../task-worker.js'
import { createBrandShowcaseConfig } from '../brand-showcase.js'
import { getSubAgentConfig } from '../index.js'
import { docExtractor, mediaExtractor } from '../visual-output-extractors.js'

describe('reference tool wiring', () => {
  it('planning/builder/discovery/media/plan-review/design-kit-build expose the reference tool', async () => {
    for (const factory of [createPlanningConfig, createBuilderConfig, createDiscoveryConfig, createMediaConfig, createPlanReviewConfig, createDesignKitBuildConfig]) {
      const cfg = await factory()
      expect(cfg.tools.reference).toBeDefined()
    }
  })

  it('design does NOT expose the reference tool', async () => {
    const cfg = await createDesignConfig()
    expect(cfg.tools.reference).toBeUndefined()
  })

  it('brand-showcase is programmatically file-only — no media/skill, so it cannot re-generate assets (AIROBUILD-3234)', async () => {
    const cfg = await createBrandShowcaseConfig()
    // File tools present so it can write the static page + surface it.
    expect(cfg.tools.str_replace_based_edit_tool).toBeDefined()
    expect(cfg.tools.showDoc).toBeDefined()
    // The regression guard: the dedicated agent has NO media/skill tools baked in, so it can only
    // reference the already-generated logo/mood slots by URL — no allow-list the model could forget.
    expect(cfg.tools.media).toBeUndefined()
    expect(cfg.tools.skill).toBeUndefined()
    // Its doc extractor surfaces the written page in the runAgent card.
    expect(cfg.visualOutputExtractors).toContain(docExtractor)
  })

  it('task-worker is programmatically media/skill-only — cannot write source files (AIROBUILD-3234)', async () => {
    const cfg = await createTaskWorkerConfig()
    expect(cfg.tools.media).toBeDefined()
    expect(cfg.tools.skill).toBeDefined()
    // No file-write tool, so a media side-task can't wander into editing the app.
    expect(cfg.tools.str_replace_based_edit_tool).toBeUndefined()
    // Its media extractor surfaces searched/generated images in the runAgent card.
    expect(cfg.visualOutputExtractors).toContain(mediaExtractor)
  })

  it('registers task-worker + brand-showcase so runAgent can resolve them (AIROBUILD-3234)', async () => {
    // reference-wiring exercises the factories directly; this guards config-map / VALID_AGENTS
    // drift by confirming the two new names also resolve through the getSubAgentConfig registry.
    expect((await getSubAgentConfig('task-worker')).id).toBe('task-worker')
    expect((await getSubAgentConfig('brand-showcase')).id).toBe('brand-showcase')
  })

  it('design-kit-build wires its core build tools and a raised output-token cap', async () => {
    const cfg = await createDesignKitBuildConfig()
    for (const tool of ['reference', 'loadUiKit', 'str_replace_based_edit_tool', 'showDoc']) {
      expect(cfg.tools[tool]).toBeDefined()
    }
    // Homepage section writes are large; the cap is lifted above the 16k sub-agent default
    // so a single section edit isn't truncated (finishReason: length). See design-kit-build.ts.
    expect(cfg.maxOutputTokens).toBe(32000)
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
