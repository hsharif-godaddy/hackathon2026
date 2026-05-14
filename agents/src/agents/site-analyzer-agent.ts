import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder,
  createFileInputFromBuffer,
  processFile,
  type ProcessedFile,
  type SupportedFileType,
  type SessionStateManager,
  createSessionStateManager
} from '@airo/ai-lib'

import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { Logger } from '../logging/index.js'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { resizeForVision } from '../utils/image-resize.js'
import type { SiteMetadata } from '../types/rebuild.js'
import { normalizeSiteType } from './site-type-helpers.js'
import { parseScreenshotDataUrl, screenshotFilenameForMime } from './screenshot-data-url.js'

const logger = Logger.create({ component: 'site-analyzer-agent' })

function defaultMetadata(): SiteMetadata {
  return {
    sourceUrl: '',
    siteType: 'content',
    sitePurpose: 'Unable to analyze site purpose',
    targetAudience: 'General audience',
    brandVoice: 'Professional',
    designStyle: 'Modern',
    colorPalette: { primary: [], secondary: [], accent: [] },
    typography: { headingFonts: [], bodyFonts: [] },
    scrapedAt: new Date().toISOString(),
    version: '1.0'
  }
}

async function buildSiteAnalyzerSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  promptBuilder.text(`# Site Analyzer Agent

You are a specialized AI agent that analyzes scraped website content to extract key information about the site's purpose, type, design, and branding.

## Your Role

Given scraped website content and a homepage screenshot, you analyze and extract:

1. **Site Type**: The fundamental app shape (marketing site vs storefront vs full-viewport tool vs admin analytics). This drives layout strategy for the rebuild.
2. **Site Purpose**: What the website is for, what it offers, who it serves
3. **Target Audience**: Demographics, interests, and needs of the intended users
4. **Brand Voice**: Tone, personality, and communication style
5. **Design Style**: Visual aesthetic classification (minimalist, bold, playful, corporate, etc.)
6. **Color Palette**: Primary, secondary, and accent colors used
7. **Typography**: Font families and typographic hierarchy

## Site type (CRITICAL — screenshot is ground truth)

Pick exactly one: **content** | **app** | **commerce** | **dashboard**.

- **content** — Marketing/docs: hero + sections + footer (most sites).
- **app** — Full-viewport tool: one dominant surface (map, canvas, board, editor, chat, game); not a product catalog or admin-metrics shell.
- **commerce** — Storefront: header + product grid/catalog + cart/PDP emphasis.
- **dashboard** — Admin/analytics: sidebar nav + metrics, KPIs, tables, or dense charts.

**Classify in this order:** (1) Hero + marketing body + footer → **content**. (2) Product grid/catalog/cart flow → **commerce**. (3) Sidebar + metrics/tables/charts → **dashboard**. (4) Else one interactive surface owns the viewport, no (2)/(3) patterns → **app**. **App vs dashboard:** persistent left nav sidebar → **dashboard**; single map/canvas/board dominates → **app**. Still uncertain → **content**.

**Downstream:** app/dashboard must not become generic marketing pages; commerce/content follow storefront vs marketing layouts.

## Analysis Approach

### 1. Content Analysis
- Read the sanitized content carefully
- Identify key messaging and value propositions
- Determine the site's primary goals
- Understand the target audience from language and content

### 2. Visual Analysis
- Examine the homepage screenshot for design patterns and overall layout shape (**siteType** uses the screenshot as primary evidence; see Site type section above)
- Identify color schemes and visual hierarchy
- Note typography choices and usage
- Classify the overall design aesthetic

### 3. Brand Analysis
- Determine brand personality from tone and visuals
- Identify unique brand elements
- Understand positioning and differentiation

## Output Format

Provide your analysis as a structured JSON object with these fields (use a \`\`\`json code block):

\`\`\`json
{
  "siteType": "content" | "app" | "commerce" | "dashboard",
  "sitePurpose": "Clear, concise description of what the site does",
  "targetAudience": "Description of the intended users",
  "brandVoice": "Tone and personality (e.g., professional, friendly, authoritative)",
  "designStyle": "Visual aesthetic classification",
  "colorPalette": {
    "primary": ["#hex1", "#hex2"],
    "secondary": ["#hex3", "#hex4"],
    "accent": ["#hex5"]
  },
  "typography": {
    "headingFonts": ["Font Family 1", "Font Family 2"],
    "bodyFonts": ["Font Family 3"]
  }
}
\`\`\`

## Guidelines

- Base **siteType** on the screenshot layout, not keywords in the text
- Be specific and actionable in your descriptions
- Extract actual hex color codes from the screenshot when possible
- Identify font families if visible in the screenshot
- Focus on the most prominent design elements
- Keep descriptions concise but informative`)

  return await promptBuilder.build()
}

export async function createSiteAnalyzerAgent(): Promise<AgentConfig> {
  const systemPrompt = await buildSiteAnalyzerSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('full')

  return {
    name: 'Site Analyzer',
    system: systemPrompt,
    model,
    modelName,
    tools: {},
    maxSteps: 5,
    temperature: 0.3,
    maxOutputTokens: 4000,
    logger: createAgentTelemetryLogger('site-analyzer'),
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

export async function createSiteAnalyzerAgentFactory(options?: {
  stateManager?: SessionStateManager
}) {
  const factory = createAgentFactory()

  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'site-analyzer'
  })

  const siteAnalyzerConfig = await createSiteAnalyzerAgent()

  const agents = factory.defineAgents({
    'site-analyzer': siteAnalyzerConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('site-analyzer'),
    stateManager
  }
}

export class SiteAnalyzerAgent {
  private factory: Awaited<ReturnType<typeof createSiteAnalyzerAgentFactory>>

  constructor(options?: { stateManager?: SessionStateManager }) {
    this.factory = null as any
  }

  async initialize(): Promise<void> {
    logger.info('site-analyzer-agent.initialization.start', {})
    this.factory = await createSiteAnalyzerAgentFactory()
    logger.info('site-analyzer-agent.initialization.complete', {})
  }

  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  async analyze(content: string, screenshotBase64?: string): Promise<SiteMetadata> {
    const agent = this.getAgent()

    const generateArgs: { files?: ProcessedFile[] } = {}
    let hasScreenshotAttachment = false

    if (screenshotBase64) {
      const parsed = parseScreenshotDataUrl(screenshotBase64)
      if (parsed) {
        try {
          const { buffer: resizedBuffer, mimeType: resizedMimeType } = await resizeForVision(
            parsed.buffer,
            parsed.mimeType
          )
          const mimeType = resizedMimeType as SupportedFileType
          const fileInput = createFileInputFromBuffer(
            resizedBuffer,
            mimeType,
            screenshotFilenameForMime(mimeType)
          )
          const processed = await processFile(fileInput)
          generateArgs.files = [processed]
          hasScreenshotAttachment = true
        } catch (error) {
          logger.warn('site-analyzer-agent.screenshot-processing-failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    const prompt = hasScreenshotAttachment
      ? `Analyze this website using the attached homepage screenshot (primary evidence) and the scraped content below. Determine siteType from the screenshot.\n\n${content}`
      : `Analyze this website from the scraped content below. No screenshot is available, so default siteType to "content" unless the text clearly indicates a full-viewport app.\n\n${content}`

    const result = await agent.generate(prompt, generateArgs)

    try {
      const jsonMatch = result.content?.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch && jsonMatch[1]) {
        const parsed = JSON.parse(jsonMatch[1])

        return {
          sourceUrl: '',
          siteType: normalizeSiteType(parsed.siteType),
          sitePurpose: parsed.sitePurpose || '',
          targetAudience: parsed.targetAudience || '',
          brandVoice: parsed.brandVoice || '',
          designStyle: parsed.designStyle || '',
          colorPalette: parsed.colorPalette || { primary: [], secondary: [], accent: [] },
          typography: parsed.typography || { headingFonts: [], bodyFonts: [] },
          scrapedAt: new Date().toISOString(),
          version: '1.0'
        }
      }

      return defaultMetadata()
    } catch (error) {
      logger.error('site-analyzer-agent.parse-error', {
        error: error instanceof Error ? error.message : String(error)
      })

      return defaultMetadata()
    }
  }

  async cleanup(): Promise<void> {
    logger.info('site-analyzer-agent.cleanup.complete', {})
  }
}
