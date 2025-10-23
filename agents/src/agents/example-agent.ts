import { 
  createAgentFactory, 
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  createPromptBuilder
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ service: 'example-agent' })

/**
 * Example Agent - demonstrates the new AgentFactory architecture
 */

/**
 * Example of before tool execution hook
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown): Promise<unknown> => {
  logger.debug('agent.example.tool.before', { toolName })
  return args
}

/**
 * Example of after tool execution hook
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> => {
  logger.debug('agent.example.tool.after', { toolName })
  return result
}

/**
 * Create the Example Agent configuration
 */
export async function createExampleAgent(): Promise<AgentConfig> {
  const promptBuilder = createPromptBuilder()
  
  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url)
  
  // Load modular prompt sections
  const systemPrompt = await promptBuilder
    .file(paths.getAgentFile('example', 'core.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getSharedFile('filesystem.md'))
    .build()

  const { model, modelName } = await getAgentModelWithName('fast') // Use fast model for example/demo purposes

  return {
    name: 'Example Agent',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      // Example tools - in a real agent, you'd select specific tools
      // For now, we'll just include a few basic ones
      fileEdit: allAILibTools.fileEdit,
      readFile: allAILibTools.readFile,
      directoryListing: allAILibTools.directoryListing,
    },
    
    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    
    // Agent metadata
    handoffs: [],
    maxSteps: 10,
    temperature: 0.3,
    maxOutputTokens: 2000
  }
}

/**
 * Create Example Agent factory with single agent
 */
export async function createExampleAgentFactory() {
  const factory = createAgentFactory()
  
  const agents = factory.defineAgents({
    example: await createExampleAgent()
  })
  
  return {
    factory,
    agents,
    getAgent: () => agents.get('example')
  }
}

/**
 * Example Agent class wrapper for backward compatibility
 * This provides the same interface as the old BaseAgent
 */
export class ExampleAgent {
  private factory: Awaited<ReturnType<typeof createExampleAgentFactory>>
  
  constructor() {
    this.factory = null as any
  }
  
  /**
   * Initialize the agent (for compatibility)
   */
  async initialize(): Promise<void> {
    logger.info('agent.example.initialize.begin', {})
    this.factory = await createExampleAgentFactory()
    logger.info('agent.example.initialize.complete', {})
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
    return this.factory.agents.getConfig('example')
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
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('agent.example.cleanup.complete', {})
  }
}
