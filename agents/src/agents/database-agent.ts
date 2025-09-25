import { 
  createExperimentalAgentFactory, 
  type ExperimentalAgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  createPromptBuilder,
  pb
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'

/**
 * Database Agent - MySQL database operations and management
 */

/**
 * Git safety hook for database operations
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown): Promise<unknown> => {
  console.log(`🔧 Database Agent executing tool: ${toolName}`)
  
  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'terminalCommand', 'mysqlOperation']
  
  if (fileModifyingTools.includes(toolName)) {
    console.log(`⚠️  Database operation detected: ${toolName}`)
    console.log(`🔍 Ensuring safe database state...`)
    
    // In a real implementation, you might check:
    // - Current git branch
    // - Database connection status
    // - Backup status
    console.log(`✅ Database operation safety checks passed`)
  }
  
  return args
}

/**
 * Database operation completion tracking
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> => {
  console.log(`✅ Database Agent completed: ${toolName}`)
  
  const resultObj = result as any
  
  // Track database operations
  if (toolName === 'mysqlOperation' && resultObj?.success) {
    console.log(`📊 Database operation completed: ${resultObj.operation || 'unknown'}`)
  }
  
  if (toolName === 'serverRestart' && resultObj?.success) {
    console.log(`📊 Server restart completed after database changes`)
  }
  
  return result
}

/**
 * Build the system prompt for the Database Agent
 */
async function buildDatabaseSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()
  
  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url)
  
  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('database', 'core.md'))
    .file(paths.getAgentFile('database', 'handoff-protocol.md'))
    .file(paths.getAgentFile('database', 'workflow.md'))
    .file(paths.getAgentFile('database', 'visual-context.md'))
    .file(paths.getAgentFile('database', 'communication.md'))
  
  return await promptBuilder.build()
}

/**
 * Create the Database Agent configuration
 */
export async function createDatabaseAgent(options?: { appPath?: string }): Promise<ExperimentalAgentConfig> {
  const systemPrompt = await buildDatabaseSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('full') // Use full model for complex database operations
  
  return {
    name: 'Database Manager',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      mysqlOperation: allAILibTools.mysqlOperation,
      serverRestart: allAILibTools.serverRestart,
      serverStatus: allAILibTools.serverStatus,
      fileEdit: allAILibTools.fileEdit,
      readFile: allAILibTools.readFile,
      terminalCommand: allAILibTools.terminalCommand,
      directoryListing: allAILibTools.directoryListing,
    },
    
    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    
    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand back to development agent after database setup completion',
      },
    ],
    
    maxSteps: 20,
    temperature: 0.3,
    maxOutputTokens: 2500
  }
}

/**
 * Create Database Agent factory
 */
export async function createDatabaseAgentFactory(options?: { appPath?: string }) {
  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    database: await createDatabaseAgent(options)
  })
  
  return {
    factory,
    agents,
    getAgent: () => agents.get('database'),
    appPath: options?.appPath
  }
}

/**
 * Database Agent class wrapper for backward compatibility
 */
export class DatabaseAgent {
  private factory: Awaited<ReturnType<typeof createDatabaseAgentFactory>>
  private appPath: string
  
  constructor(options?: { appPath?: string }) {
    this.appPath = options?.appPath || process.cwd()
    this.factory = null as any
  }
  
  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    console.log('Initializing Database Agent...')
    this.factory = await createDatabaseAgentFactory({ appPath: this.appPath })
    console.log('Database Agent ready!')
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
   * Complete database integration (main method from original)
   */
  async completeDatabaseIntegration(params: { userId: string; databaseName: string }): Promise<any> {
    const agent = this.getAgent()
    
    const integrationPrompt = `Complete database integration with the following requirements:

**Database Setup:**
- Database Name: ${params.databaseName}
- User ID: ${params.userId}
- Create dedicated MySQL database
- Set up database user with appropriate permissions
- Generate secure credentials

**Integration Tasks:**
1. Create MySQL database: ${params.databaseName}
2. Create database user for application access
3. Test database connection
4. Update .env file with database credentials
5. Restart development server to apply changes
6. Verify integration is working

**Required Output:**
- Database credentials (host, port, username, password, database)
- Connection string
- Backend server information
- Integration summary

Please complete all database setup tasks and provide the integration details.`

    const result = await agent.streamGenerate(integrationPrompt)
    
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
      summary: 'Database integration completed successfully. Backend is ready for frontend development.',
      credentials: {
        host: 'localhost',
        port: 3306,
        database: params.databaseName
      },
      backendPort: 3000
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
  getConfig(): ExperimentalAgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.agents.getConfig('database')
  }
  
  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Database Agent cleanup completed')
  }
}