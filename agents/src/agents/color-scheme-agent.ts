import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder,
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { Logger } from '../logging/index.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'

const logger = Logger.create({ service: 'color-scheme-agent' })

/**
 * Color Scheme Agent - Interactive color palette designer
 * Helps users discover and create perfect color schemes for their applications
 */

/**
 * Build the system prompt for the Color Scheme Agent
 */
async function buildColorSchemeSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url)

  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('color-scheme', 'core.md'))
    .file(paths.getAgentFile('color-scheme', 'themes.md'))
    .file(paths.getAgentFile('color-scheme', 'handoff.md'))

  return await promptBuilder.build()
}

/**
 * Create the Color Scheme Agent configuration
 */
export async function createColorSchemeAgent(): Promise<AgentConfig> {
  const systemPrompt = await buildColorSchemeSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('fast') // Use fast model for color scheme generation

  return {
    name: 'Color Scheme Designer',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      cssColor: allAILibTools.cssColor,
      cssSuggest: allAILibTools.cssSuggest,
      todoList: allAILibTools.todoList,
      suggestedResponse: allAILibTools.suggestedResponse,
      // Global tools (like oauthAccessToken) are added by the factory
    },

    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand off to development agent to build the rest of the application using the updated color scheme',
      },
      {
        agentName: 'marketing',
        description: 'SEO optimization and marketing strategy for websites',
      },
    ],

    maxSteps: 15,
    temperature: 0.7, // Higher temperature for creative color work
    maxOutputTokens: 3000,

    metadata: {
      contextPreferences: {
        includeAppContext: false,
        includeVisualContext: true,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
        includeTemplateDescription: false
      }
    }
  }
}

/**
 * Create Color Scheme Agent factory with handoff support
 */
export async function createColorSchemeAgentFactory() {
  const factory = createAgentFactory()

  const agents = factory.defineAgents({
    colorScheme: await createColorSchemeAgent()
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('colorScheme')
  }
}

/**
 * Color Scheme Agent class wrapper for backward compatibility
 */
export class ColorSchemeAgent {
  private factory: Awaited<ReturnType<typeof createColorSchemeAgentFactory>>

  constructor() {
    // Note: This will be async in the new system
    this.factory = null as any
  }

  /**
   * Initialize the agent (required for new system)
   */
  async initialize(): Promise<void> {
    logger.info('agent.color-scheme.initialize.begin', {})
    this.factory = await createColorSchemeAgentFactory()
    logger.info('agent.color-scheme.initialize.complete', {})
  }

  /**
   * Get the agent instance
   */
  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  /**
   * Get agent factory for advanced usage
   */
  getFactory() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.factory
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.agents.getConfig('colorScheme')
  }

  /**
   * Stream generate response (main interface)
   */
  async streamGenerate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.streamGenerate(prompt, options)
  }

  /**
   * Generate response (non-streaming)
   */
  async generate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.generate(prompt, options)
  }

  /**
   * Get agent name
   */
  getName(): string {
    return this.getAgent().getName()
  }

  /**
   * Hand off to development agent
   */
  async handoffToDevelop(colorScheme: any): Promise<any> {
    const factory = this.getFactory()

    return factory.executeHandoff(
      'colorScheme',
      'develop',
      {
        task: 'Implement the finalized color scheme in the application',
        context: {
          colorScheme,
          implementationNotes: 'Apply the color palette to CSS variables, components, and design tokens'
        },
        parameters: { colorScheme },
        metadata: {
          sourceAgent: 'colorScheme',
          timestamp: new Date().toISOString(),
          reason: 'Color scheme design completed, ready for implementation'
        }
      }
    )
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('agent.color-scheme.cleanup.complete', {})
  }
}
