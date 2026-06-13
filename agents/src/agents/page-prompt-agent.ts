import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder,
  type SessionStateManager,
  createSessionStateManager
} from '@airo/ai-lib'

import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { Logger } from '../logging/index.js'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import type { AssetManifest, PageContent, SiteMetadata, StylePreferences } from '../types/rebuild.js'
import { buildUserPrompt } from './page-prompt/user-prompt-builder.js'
import { buildEmbeddedTextConstraint } from './page-prompt/embedded-text-constraint.js'
import { processScreenshot } from './page-prompt/screenshot-processing.js'
import { shouldPreserveDesign } from './page-prompt/style-instructions.js'

// Re-exported so callers (RebuildPromptBuilder, the rebuild-prompts eval) derive
// preserveDesign from the same predicate the user-prompt design block uses.
export { shouldPreserveDesign }

const logger = Logger.create({ component: 'page-prompt-agent' })

/**
 * Compose the PagePromptAgent system prompt from modular markdown files
 * (`src/prompts/page-prompt/*.md`). The file list is data-driven so future
 * intake-form / fidelity-dial selections can extend it without restructuring.
 */
export interface PagePromptSystemPromptOptions {
  isFirstPage: boolean;
  /** Atlas extraction is on, so DETECTED INTERACTIVE PATTERNS / DETECTED FORMS
   * blocks may appear in the user prompt and the corresponding preserve-* files
   * should load. Future fidelity dials will likely supplant this single boolean
   * with per-dimension toggles. */
  useAtlasCrawler: boolean;
  /** True when the design direction is "keep-similar" (a faithful clone).
   * Selects design-preserve.md (reproduce the source, don't add sections) over
   * design-redesign.md (the distinctive "Let Airo Decide" redesign brief).
   *
   * Must equal the user-prompt design block's branch in style-instructions.ts.
   * That coupling is enforced at the call sites, not here: both the production
   * caller (RebuildPromptBuilder) and the eval derive this from the same
   * `shouldPreserveDesign(stylePreferences)` predicate that the user-prompt
   * block keys off. Keep new callers on that helper. */
  preserveDesign: boolean;
}

export function selectSystemPromptFiles(opts: PagePromptSystemPromptOptions): string[] {
  return [
    'base.md',
    // visual-reference applies only when a homepage screenshot may be attached
    // (PagePromptAgent only attaches one for first-page rebuilds), so the
    // directive is dead weight on inner pages.
    ...(opts.isFirstPage ? ['visual-reference.md'] : []),
    ...(opts.useAtlasCrawler ? ['preserve-interactive-patterns.md', 'preserve-forms.md'] : []),
    opts.isFirstPage ? 'homepage-setup.md' : 'inner-page-note.md',
    // Asset sourcing forks on the same clone-vs-redesign predicate as the design
    // brief: preserve reuses the source images, redesign keeps only the logo and
    // pulls fresh imagery for everything else.
    opts.preserveDesign ? 'asset-integration.md' : 'asset-integration-redesign.md',
    // The redesign brief (design-redesign.md) actively tells the model to add
    // bento grids, differentiation flourishes, and "social proof" sections — on
    // a faithful clone that fabricates sections the source never had. Load the
    // preserve fragment instead when keeping the source design.
    ...(opts.isFirstPage
      ? ['homepage-structure.md', opts.preserveDesign ? 'design-preserve.md' : 'design-redesign.md', 'output-format-homepage.md']
      : ['output-format-inner-page.md']),
  ];
}

async function buildPagePromptSystemPrompt(opts: PagePromptSystemPromptOptions): Promise<string> {
  const paths = getModularPromptPaths(import.meta.url)
  const promptBuilder = createPromptBuilder()
  for (const file of selectSystemPromptFiles(opts)) {
    promptBuilder.file(paths.getAgentFile('page-prompt', file))
  }
  return await promptBuilder.build()
}


export async function createPagePromptAgent(isFirstPage: boolean, useAtlasCrawler: boolean, preserveDesign: boolean): Promise<AgentConfig> {
  const systemPrompt = await buildPagePromptSystemPrompt({ isFirstPage, useAtlasCrawler, preserveDesign })
  const { model, modelName } = await getAgentModelWithName('full')

  return {
    name: isFirstPage ? 'Page Prompt Generator (Homepage)' : 'Page Prompt Generator (Inner Page)',
    system: systemPrompt,
    model,
    modelName,
    tools: {},
    maxSteps: 5,
    temperature: 0.4,
    maxOutputTokens: 4000,
    logger: createAgentTelemetryLogger('page-prompt'),
    enablePromptCaching: false,

    metadata: {
      contextPreferences: {
        includeAppContext: false,
        includeVisualContext: false,
        includeConversationHistory: false,
        includeTemplateDescription: false
      }
    }
  }
}

export async function createPagePromptAgentFactory(options: {
  stateManager?: SessionStateManager
  isFirstPage?: boolean
  useAtlasCrawler?: boolean
  // Required: a clone (keep-similar) vs a redesign must be an explicit decision —
  // a silent default here would re-introduce AIROBUILD-2241 by gluing the wrong
  // system fragment to the user-prompt block. Derive via shouldPreserveDesign.
  preserveDesign: boolean
}) {
  const factory = createAgentFactory()
  const isFirstPage = options.isFirstPage ?? true
  const useAtlasCrawler = options.useAtlasCrawler ?? false
  const preserveDesign = options.preserveDesign

  const stateManager = options.stateManager || createSessionStateManager({
    defaultAgentId: 'page-prompt'
  })

  const pagePromptConfig = await createPagePromptAgent(isFirstPage, useAtlasCrawler, preserveDesign)

  const agents = factory.defineAgents({
    'page-prompt': pagePromptConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('page-prompt'),
    stateManager
  }
}

export class PagePromptAgent {
  private factory: Awaited<ReturnType<typeof createPagePromptAgentFactory>> | null = null
  private useAtlasCrawler: boolean
  private isFirstPage: boolean
  private preserveDesign: boolean

  // preserveDesign is required (not defaulted): callers must explicitly decide
  // clone vs redesign — see shouldPreserveDesign. A silent default would let a
  // future redesign caller glue the preserve system fragment to a redesign
  // user-prompt block (AIROBUILD-2241).
  constructor(options: { stateManager?: SessionStateManager; isFirstPage?: boolean; useAtlasCrawler?: boolean; preserveDesign: boolean }) {
    this.isFirstPage = options.isFirstPage ?? true
    this.useAtlasCrawler = options.useAtlasCrawler ?? false
    this.preserveDesign = options.preserveDesign
  }

  async initialize(): Promise<void> {
    logger.info('page-prompt-agent.initialization.start', { isFirstPage: this.isFirstPage, preserveDesign: this.preserveDesign })
    this.factory = await createPagePromptAgentFactory({ isFirstPage: this.isFirstPage, useAtlasCrawler: this.useAtlasCrawler, preserveDesign: this.preserveDesign })
    logger.info('page-prompt-agent.initialization.complete', { isFirstPage: this.isFirstPage, preserveDesign: this.preserveDesign })
  }

  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  async generate(
    siteMetadata: SiteMetadata,
    pageContent: PageContent,
    stylePreferences: StylePreferences,
    assetManifest: AssetManifest,
    isFirstPage: boolean = true,
    screenshotBase64?: string
  ): Promise<string> {
    const agent = this.getAgent()
    // Process the screenshot first so the prompt can reflect whether an image
    // was actually attached: processScreenshot returns [] on a parse failure
    // even when screenshotBase64 is set, and files.length is the true signal
    // of what the model receives.
    const files = await processScreenshot(screenshotBase64)
    const hasScreenshot = files.length > 0
    const prompt = buildUserPrompt({ siteMetadata, pageContent, stylePreferences, assetManifest, isFirstPage, hasScreenshot })
    const result = await agent.generate(prompt, hasScreenshot ? { files } : {})

    // PagePromptAgent's rewrite drops the per-asset "do NOT overlay" note that
    // buildUserPrompt emits, so re-assert it deterministically after generation —
    // the rewrite can't summarize away what we append below it. (AIROBUILD-2430)
    return result.content + buildEmbeddedTextConstraint(assetManifest.assets)
  }

  async cleanup(): Promise<void> {
    logger.info('page-prompt-agent.cleanup.complete', {})
  }
}
