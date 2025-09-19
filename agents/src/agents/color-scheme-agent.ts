import { 
  createExperimentalAgentFactory, 
  getModel,
  type ExperimentalAgentConfig,
  createPromptBuilder,
  pb
} from '@airo/ai-lib'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getPromptPath } from '../utils/prompt-utils.js'

/**
 * Color Scheme Agent - Interactive color palette designer
 * Helps users discover and create perfect color schemes for their applications
 */

/**
 * Build the system prompt for the Color Scheme Agent
 */
async function buildColorSchemeSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const promptPath = getPromptPath('color-scheme', import.meta.url)
  
  return await promptBuilder
    .file(promptPath)
    .build()
}

/**
 * Create the Color Scheme Agent configuration
 */
export async function createColorSchemeAgent(): Promise<ExperimentalAgentConfig> {
  const systemPrompt = await buildColorSchemeSystemPrompt()
  
  return {
    name: 'Color Scheme Designer',
    system: systemPrompt,
    model: await getModel('claude-sonnet-4'),
    tools: {
      appPlan: allAILibTools.appPlan,
      fileEdit: allAILibTools.fileEdit,
      readFile: allAILibTools.readFile,
      directoryListing: allAILibTools.directoryListing,
      imageGenerate: allAILibTools.imageGenerate,
    },
    
    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand off to development agent to implement the chosen color scheme in the application',
      },
    ],
    
    maxSteps: 15,
    temperature: 0.7, // Higher temperature for creative color work
    maxOutputTokens: 3000
  }
}

/**
 * Create Color Scheme Agent factory with handoff support
 */
export async function createColorSchemeAgentFactory() {
  const factory = createExperimentalAgentFactory()
  
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
    console.log('Initializing Color Scheme Agent...')
    this.factory = await createColorSchemeAgentFactory()
    console.log('Color Scheme Agent ready!')
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
  getConfig(): ExperimentalAgentConfig {
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
    console.log('🧹 Color Scheme Agent cleanup completed')
  }
}