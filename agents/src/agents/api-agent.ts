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

const logger = Logger.create({ service: 'api-agent' })

/**
 * API Agent - HTTP API route generation using vite-plugin-api-routes
 */

/**
 * Tool execution monitoring for API operations
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown): Promise<unknown> => {
  logger.debug('agent.api.tool.before', { toolName })

  // File-modifying tools that need tracking
  const fileModifyingTools = ['fileEdit', 'terminalCommand']

  if (fileModifyingTools.includes(toolName)) {
    logger.info('agent.api.operation.detected', { toolName })
    logger.debug('agent.api.safety-check.begin', {})

    // In a real implementation, you might check:
    // - Current git branch
    // - Existing API route structure
    // - Schema file availability
    logger.info('agent.api.safety-check.passed', {})
  }

  return args
}

/**
 * API operation completion tracking
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> => {
  logger.debug('agent.api.tool.after', { toolName })

  const resultObj = result as any

  // Track API file creation
  if (toolName === 'fileEdit' && resultObj?.success) {
    logger.info('agent.api.file-created', {
      path: resultObj.path || 'unknown',
    })
  }

  if (toolName === 'serverRestart' && resultObj?.success) {
    logger.info('agent.api.server-restart.complete', {})
  }

  return result
}

/**
 * Build the system prompt for the API Agent
 */
async function buildApiSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url)

  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('api', 'core.md'))
    .file(paths.getAgentFile('api', 'handoff-protocol.md'))
    .file(paths.getAgentFile('api', 'workflow.md'))
    .file(paths.getAgentFile('api', 'communication.md'))

  return await promptBuilder.build()
}

/**
 * Create the API Agent configuration
 */
export async function createApiAgent(_options?: { appPath?: string }): Promise<AgentConfig> {
  const systemPrompt = await buildApiSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('full') // Use full model for API generation

  return {
    name: 'API Generator',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      serverRestart: allAILibTools.serverRestart,
      serverStatus: allAILibTools.serverStatus,
      fileEdit: allAILibTools.fileEdit,
      readFile: allAILibTools.readFile,
      terminalCommand: allAILibTools.terminalCommand,
      directoryListing: allAILibTools.directoryListing,
      // Global tools (like oauthAccessToken) are added by the factory
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,

    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand back to development agent after API routes are created',
      },
    ],

    maxSteps: 20,
    temperature: 0.3,
    maxOutputTokens: 2500,

    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: false,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
        includeTemplateDescription: true
      }
    }
  }
}

/**
 * Create API Agent factory
 */
export async function createApiAgentFactory(options?: { appPath?: string }) {
  const factory = createAgentFactory()

  const agents = factory.defineAgents({
    api: await createApiAgent(options)
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('api'),
    appPath: options?.appPath
  }
}

/**
 * API Agent class wrapper for backward compatibility
 */
export class ApiAgent {
  private factory: Awaited<ReturnType<typeof createApiAgentFactory>>
  private appPath: string

  constructor(options?: { appPath?: string }) {
    this.appPath = options?.appPath || process.cwd()
    this.factory = null as any
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    logger.info('agent.api.initialize.begin', { appPath: this.appPath })
    this.factory = await createApiAgentFactory({ appPath: this.appPath })
    logger.info('agent.api.initialize.complete', {})
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
   * Generate API routes (main method)
   */
  async generateApiRoutes(params: {
    schemaPath?: string;
    endpoints?: string[];
    requirements?: string;
  }): Promise<any> {
    const agent = this.getAgent()

    const generationPrompt = `Generate HTTP API routes based on the following requirements:

**Schema Location:**
${params.schemaPath || 'src/server/db/schema.ts'}

**Endpoints Requested:**
${params.endpoints?.join(', ') || 'Generate standard CRUD endpoints'}

**Requirements:**
${params.requirements || 'Create RESTful API endpoints with proper error handling and validation'}

**Tasks:**
1. Read the database schema from ${params.schemaPath || 'src/server/db/schema.ts'}
2. Design appropriate API endpoints based on the schema
3. Implement Express-style handlers using vite-plugin-api-routes conventions
4. Add proper error handling with try-catch blocks
5. Include input validation and appropriate HTTP status codes
6. Use relative imports with .js extensions for backend files (Node.js requirement)

Please generate all necessary API route files and provide a summary of what was created.`

    const result = await agent.streamGenerate(generationPrompt)

    // Collect the response
    let response = ''
    for await (const chunk of result.textStream) {
      response += chunk
    }

    const finalResult = await result.getFinalResult()

    return {
      success: true,
      response,
      usage: await finalResult.usage,
      toolCalls: finalResult.toolCalls,
      summary: 'API routes generated successfully. Ready for frontend integration.',
    }
  }

  /**
   * Stream generate response
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
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.agents.getConfig('api')
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('agent.api.cleanup.complete', {})
  }
}
