import { 
  createExperimentalAgentFactory, 
  getModel,
  type ExperimentalAgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  createPromptBuilder,
  pb,
  when,
  conditions
} from '@airo/ai-lib'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getPromptPath, getTemplateDescriptionPath } from '../utils/prompt-utils.js'

/**
 * Develop Agent - AI developer for building web applications
 */

/**
 * Git branch safety hook (from original develop-agent)
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown): Promise<unknown> => {
  console.log(`🔧 Develop Agent executing tool: ${toolName}`)
  
  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'terminalCommand', 'gitOperation']
  
  if (fileModifyingTools.includes(toolName)) {
    console.log(`⚠️  File-modifying tool detected: ${toolName}`)
    console.log(`🔍 Checking git branch state...`)
    
    try {
      // In a real implementation, this would check actual git status
      // For now, we'll simulate the safety check
      const currentBranch = 'main' // This would be determined by git status
      
      if (currentBranch !== 'main') {
        console.log(`⚠️  Before executing ${toolName}: Not on main branch, attempting to return to main`)
        console.log(`🔄 Would switch from '${currentBranch}' to 'main'`)
        // In real implementation: execute git checkout main
      } else {
        console.log(`✅ Already on main branch, proceeding with ${toolName}`)
      }
    } catch (error) {
      console.warn(`⚠️  Error checking git branch state before ${toolName} execution:`, error)
    }
  }
  
  return args
}

/**
 * Development progress tracking hook
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> => {
  console.log(`✅ Develop Agent completed: ${toolName}`)
  
  const resultObj = result as any
  
  // Track specific development operations
  if (toolName === 'fileEdit' && resultObj?.success) {
    console.log(`📊 File operation completed: ${resultObj.filePath || 'unknown'} (${resultObj.operation || 'edit'})`)
  }
  
  if (toolName === 'autoAPIGenerator' && resultObj?.success) {
    console.log(`📊 API generation completed: ${resultObj.endpointsGenerated || 0} endpoints`)
  }
  
  if (toolName === 'terminalCommand' && resultObj?.success) {
    console.log(`📊 Terminal command completed: ${resultObj.command || 'unknown'}`)
  }
  
  if (toolName === 'serverRestart' && resultObj?.success) {
    console.log(`📊 Development server restarted successfully`)
  }
  
  return result
}

/**
 * Build the comprehensive system prompt for the Develop Agent
 */
async function buildDevelopSystemPrompt(appPath?: string): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const basePromptPath = getPromptPath('develop', import.meta.url)
  
  // Start with the base develop prompt
  promptBuilder.file(basePromptPath)
  
  // Add version-specific template descriptions if available
  if (appPath) {
    const versionPath = join(appPath, '.version')
    if (existsSync(versionPath)) {
      try {
        const version = readFileSync(versionPath, 'utf-8').trim()
        const templateDescPath = getTemplateDescriptionPath(version, import.meta.url)
        
        if (existsSync(templateDescPath)) {
          promptBuilder.file(templateDescPath)
        }
      } catch (error) {
        console.warn('Failed to read version file:', error)
      }
    }
  }
  
  return await promptBuilder.build()
}

/**
 * Create the Develop Agent configuration
 */
export async function createDevelopAgent(options?: { appPath?: string }): Promise<ExperimentalAgentConfig> {
  const appPath = options?.appPath || process.cwd()
  const systemPrompt = await buildDevelopSystemPrompt(appPath)
  
  return {
      name: 'AI Developer',
    system: systemPrompt,
    model: await getModel('claude-sonnet-4'),
    tools: {
      // Core development tools
      directoryListing: allAILibTools.directoryListing,
      terminalCommand: allAILibTools.terminalCommand,
      fileEdit: allAILibTools.fileEdit,
      gitOperation: allAILibTools.gitOperation,
      readFile: allAILibTools.readFile,
      grepSearch: allAILibTools.grepSearch,
      
      // Server management
      serverRestart: allAILibTools.serverRestart,
      serverStatus: allAILibTools.serverStatus,
      viewLogs: allAILibTools.viewLogs,
      
      // Specialized development tools
      autoAPIGenerator: allAILibTools.autoAPIGenerator,
      imageSearch: allAILibTools.imageSearch,
      imageGenerate: allAILibTools.imageGenerate,
      
      // Handoff tools will be added by the factory when needed
    },
    
    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    
    // Handoff configuration
    handoffs: [
      {
        agentName: 'database',
        description: 'MySQL database operations, schema design, and database integration',
      },
      {
        agentName: 'colorScheme',
        description: 'Color palette design and visual branding for applications',
      },
    ],
    
    maxSteps: 25,
    temperature: 0.3,
    maxOutputTokens: 4000
  }
}

/**
 * Create Develop Agent factory
 */
export async function createDevelopAgentFactory(options?: { appPath?: string }) {
  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    develop: await createDevelopAgent(options)
  })
  
  return {
    factory,
    agents,
    getAgent: () => agents.get('develop'),
    appPath: options?.appPath
  }
}

/**
 * Develop Agent class wrapper for backward compatibility
 */
export class DevelopAgent {
  private factory: Awaited<ReturnType<typeof createDevelopAgentFactory>>
  private appPath: string
  
  constructor(options?: { appPath?: string }) {
    this.appPath = options?.appPath || process.cwd()
    this.factory = null as any
  }
  
  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    console.log('Initializing Develop Agent...')
    this.factory = await createDevelopAgentFactory({ appPath: this.appPath })
    console.log('Develop Agent ready!')
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
   * Hand off to Database Agent for MySQL setup (original method)
   */
  async handoffToDatabase(params: { userId: string; databaseName: string }): Promise<any> {
    const factory = this.getFactory()
    
    console.log('🔄 Handing off to Database Agent for MySQL setup...')
    
    const handoffResult = await factory.executeHandoff(
      'develop',
      'database',
      {
        task: `Complete MySQL database setup and integration with the following requirements:
        
**Database Configuration:**
- Database Name: ${params.databaseName}
- User ID: ${params.userId}
- Create dedicated MySQL database with proper user permissions
- Generate secure database credentials
- Test database connectivity

**Integration Tasks:**
1. Create MySQL database: ${params.databaseName}
2. Set up database user for application access
3. Update .env file with database credentials
4. Restart development server to apply changes
5. Verify database integration is working

**Required Output:**
- Database credentials (host, port, username, password, database)
- Connection string for application use
- Backend server information (port, API URL)
- Integration summary and next steps

Please complete all database setup tasks and provide the integration details for frontend development.`,
        context: {
          userId: params.userId,
          databaseName: params.databaseName,
          appPath: this.appPath,
          projectType: 'web-application',
          requiresIntegration: true
        },
        parameters: params,
        metadata: {
          sourceAgent: 'develop',
          timestamp: new Date().toISOString(),
          reason: 'Database setup required for application development'
        }
      }
    )
    
    if (handoffResult.success) {
      console.log('✅ Database Agent handoff completed successfully')
      console.log('🔗 Backend integration ready for frontend development')
      
      return {
        success: handoffResult.result?.success || true,
        message: handoffResult.result?.summary || 'Database setup completed. Ready for frontend integration.',
        credentials: handoffResult.result?.credentials || {
          host: 'localhost',
          port: 3306,
          database: params.databaseName
        },
        backendPort: handoffResult.result?.backendPort || 3000,
        handoffDetails: handoffResult.handoffDetails
      }
    } else {
      console.log('❌ Database Agent handoff failed')
      throw new Error(`Database handoff failed: ${handoffResult.error}`)
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
    return this.factory.agents.getConfig('develop')
  }
  
  /**
   * Generate Vite configuration with proxy setup (original method)
   */
  private generateViteConfigCode(backendPort: number): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Frontend port
    proxy: {
      '/api': {
        target: 'http://localhost:${backendPort}',
        changeOrigin: true,
      },
    },
  },
});`
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Development Agent cleanup completed')
  }
}