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
import { processScreenshot } from './page-prompt/screenshot-processing.js'

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
}

function selectSystemPromptFiles(opts: PagePromptSystemPromptOptions): string[] {
  return [
    'base.md',
    // visual-reference applies only when a homepage screenshot may be attached
    // (PagePromptAgent only attaches one for first-page rebuilds), so the
    // directive is dead weight on inner pages.
    ...(opts.isFirstPage ? ['visual-reference.md'] : []),
    ...(opts.useAtlasCrawler ? ['preserve-interactive-patterns.md', 'preserve-forms.md'] : []),
    opts.isFirstPage ? 'homepage-setup.md' : 'inner-page-note.md',
    'asset-integration.md',
    ...(opts.isFirstPage ? ['homepage-structure.md', 'design-redesign.md', 'output-format-homepage.md'] : ['output-format-inner-page.md']),
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


export async function createPagePromptAgent(isFirstPage: boolean = true, useAtlasCrawler: boolean = false): Promise<AgentConfig> {
  const systemPrompt = await buildPagePromptSystemPrompt({ isFirstPage, useAtlasCrawler })
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

export async function createPagePromptAgentFactory(options?: {
  stateManager?: SessionStateManager
  isFirstPage?: boolean
  useAtlasCrawler?: boolean
}) {
  const factory = createAgentFactory()
  const isFirstPage = options?.isFirstPage ?? true
  const useAtlasCrawler = options?.useAtlasCrawler ?? false

  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'page-prompt'
  })

  const pagePromptConfig = await createPagePromptAgent(isFirstPage, useAtlasCrawler)

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

  constructor(options?: { stateManager?: SessionStateManager; isFirstPage?: boolean; useAtlasCrawler?: boolean }) {
    this.isFirstPage = options?.isFirstPage ?? true
    this.useAtlasCrawler = options?.useAtlasCrawler ?? false
  }

  async initialize(): Promise<void> {
    logger.info('page-prompt-agent.initialization.start', { isFirstPage: this.isFirstPage })
    this.factory = await createPagePromptAgentFactory({ isFirstPage: this.isFirstPage, useAtlasCrawler: this.useAtlasCrawler })
    logger.info('page-prompt-agent.initialization.complete', { isFirstPage: this.isFirstPage })
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
    const prompt = buildUserPrompt({ siteMetadata, pageContent, stylePreferences, assetManifest, isFirstPage })
    const files = await processScreenshot(screenshotBase64)
    const result = await agent.generate(prompt, files.length > 0 ? { files } : {})
    return result.content
  }

  async cleanup(): Promise<void> {
    logger.info('page-prompt-agent.cleanup.complete', {})
  }
}
