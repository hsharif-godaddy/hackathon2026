import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
  createSessionStateManager
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { Logger } from '../logging/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { skills } from '../services/features.js'
import { SkillLoaderTool, buildSkillsPromptSection } from '../tools/skill-loader-tool.js'

const logger = Logger.create({ component: 'marketing-agent' })

async function buildMarketingSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  // Get available skills list with whenToUse guidance
  const skillLoader = new SkillLoaderTool()
  const skillsResult = await skillLoader.listSkills()
  const skillsSection = skillsResult.success && skillsResult.skills?.length
    ? buildSkillsPromptSection(skillsResult.skills)
    : ''

  // Order: Identity → Voice → Technical details
  promptBuilder
    .file(paths.getAgentFile('marketing', 'core.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getSharedFile('security.md'))

  // Skills section at end of prompt for emphasis
  if (skillsSection) {
    promptBuilder.text(`\n${skillsSection}\n`)
  }

  return await promptBuilder.build()
}

export async function createMarketingAgent(): Promise<AgentConfig> {
  const systemPrompt = await buildMarketingSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('full')
  const isSocialEnabled = skills.isEnabled('social')

  const baseTools = {
    seoAnalysis: allAILibTools.seoAnalysis,
    readFile: allAILibTools.readFile,
    str_replace_based_edit_tool: allAILibTools.str_replace_based_edit_tool,
    todoList: allAILibTools.todoList,
    directoryListing: allAILibTools.directoryListing,
    grepSearch: allAILibTools.grepSearch,
    suggestedResponse: allAILibTools.suggestedResponse,
    skill: allAILibTools.skill,
    media: allAILibTools.media,
  }

  const socialTools = isSocialEnabled ? {
    socialRead: allAILibTools.socialRead,
    socialPostCreate: allAILibTools.socialPostCreate,
    socialPostPublish: allAILibTools.socialPostPublish,
    googleReviews: allAILibTools.googleReviews,
  } : {}

  return {
    id: 'marketing',
    name: 'Airo Marketer',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      ...baseTools,
      ...socialTools
    },

    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand off to developer for website modifications',
      },
    ],

    maxSteps: 50,
    temperature: 0.4,
    maxOutputTokens: 8000,
    timeout: { stepMs: 600_000 },
    logger: createAgentTelemetryLogger('marketing'),

    // Enable prompt caching for cost savings
    // Marketing agent benefits from caching during multi-turn SEO analysis and content optimization conversations
    enablePromptCaching: true,

    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: true,
        includeConversationHistory: true,
        includeTemplateDescription: true
      }
    }
  }
}

export async function createMarketingAgentFactory(options?: {
  appPath?: string
  stateManager?: SessionStateManager
  sessionId?: string
}) {
  const factory = createAgentFactory()
  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'marketing'
  })

  const marketingConfig = await createMarketingAgent()

  if (options?.sessionId) {
    const validTargets = (marketingConfig.handoffs || []).map(h => h.agentName)
    marketingConfig.tools = {
      ...marketingConfig.tools,
      handoff: createHandoffTool({
        sourceAgentId: 'marketing',
        validTargets,
        stateManager,
        sessionId: options.sessionId
      })
    }
  }

  const agents = factory.defineAgents({
    marketing: marketingConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('marketing'),
    stateManager,
    appPath: options?.appPath
  }
}

export class MarketingAgent {
  private factory: Awaited<ReturnType<typeof createMarketingAgentFactory>>
  private appPath: string
  private sessionId?: string
  private stateManager?: SessionStateManager

  constructor(options?: {
    appPath?: string
    sessionId?: string
    stateManager?: SessionStateManager
  }) {
    this.appPath = options?.appPath || process.cwd()
    if (options?.sessionId) this.sessionId = options.sessionId
    if (options?.stateManager) this.stateManager = options.stateManager
    this.factory = null as any
  }

  async initialize(): Promise<void> {
    logger.info('marketing_agent.initialization.start', {
      appPath: this.appPath,
      hasSessionId: !!this.sessionId,
      hasStateManager: !!this.stateManager
    });

    const factoryOptions: {
      appPath: string
      sessionId?: string
      stateManager?: SessionStateManager
    } = { appPath: this.appPath }

    if (this.sessionId) factoryOptions.sessionId = this.sessionId
    if (this.stateManager) factoryOptions.stateManager = this.stateManager

    this.factory = await createMarketingAgentFactory(factoryOptions)
    logger.info('marketing_agent.initialization.complete', {
      appPath: this.appPath
    });
  }

  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  async streamGenerate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.streamGenerate(prompt, options)
  }

  async generate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.generate(prompt, options)
  }

  getName(): string {
    return this.getAgent().getName()
  }

  async cleanup(): Promise<void> {
    logger.info('marketing_agent.cleanup.complete', {
      appPath: this.appPath
    });
  }
}
