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
import type { SiteMetadata } from '../types/rebuild.js'

const logger = Logger.create({ service: 'site-analyzer-agent' })

async function buildSiteAnalyzerSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  promptBuilder.text(`# Site Analyzer Agent

You are a specialized AI agent that analyzes scraped website content to extract key information about the site's purpose, design, and branding.

## Your Role

Given scraped website content and screenshots, you analyze and extract:

1. **Site Purpose**: What the website is for, what it offers, who it serves
2. **Target Audience**: Demographics, interests, and needs of the intended users
3. **Brand Voice**: Tone, personality, and communication style
4. **Design Style**: Visual aesthetic classification (minimalist, bold, playful, corporate, etc.)
5. **Color Palette**: Primary, secondary, and accent colors used
6. **Typography**: Font families and typographic hierarchy

## Analysis Approach

### 1. Content Analysis
- Read the sanitized content carefully
- Identify key messaging and value propositions
- Determine the site's primary goals
- Understand the target audience from language and content

### 2. Visual Analysis
- Examine screenshots for design patterns
- Identify color schemes and visual hierarchy
- Note typography choices and usage
- Classify the overall design aesthetic

### 3. Brand Analysis
- Determine brand personality from tone and visuals
- Identify unique brand elements
- Understand positioning and differentiation

## Output Format

Provide your analysis as a structured JSON object with these fields:

\`\`\`json
{
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

- Be specific and actionable in your descriptions
- Extract actual hex color codes from screenshots when possible
- Identify font families if visible in screenshots
- Focus on the most prominent design elements
- Keep descriptions concise but informative
- Base analysis on evidence from content and visuals`)

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
    providerOptions: {
      anthropic: {
        effort: 'medium',
      },
    },
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
    defaultAgentId: 'site-analyzer',
    enableLogging: true
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

    const prompt = `Analyze this website and provide a structured analysis:\n\n${content}`

    const metadata: any = {}
    if (screenshotBase64) {
      metadata._screenshots = [screenshotBase64]
    }

    const result = await agent.generate(prompt)

    try {
      const jsonMatch = result.content?.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch && jsonMatch[1]) {
        const parsed = JSON.parse(jsonMatch[1])

        return {
          sourceUrl: '',
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

      return {
        sourceUrl: '',
        sitePurpose: 'Unable to analyze site purpose',
        targetAudience: 'General audience',
        brandVoice: 'Professional',
        designStyle: 'Modern',
        colorPalette: { primary: [], secondary: [], accent: [] },
        typography: { headingFonts: [], bodyFonts: [] },
        scrapedAt: new Date().toISOString(),
        version: '1.0'
      }
    } catch (error) {
      logger.error('site-analyzer-agent.parse-error', {
        error: error instanceof Error ? error.message : String(error)
      })

      return {
        sourceUrl: '',
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
  }

  async cleanup(): Promise<void> {
    logger.info('site-analyzer-agent.cleanup.complete', {})
  }
}
