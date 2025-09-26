import { 
  createExperimentalAgentFactory, 
  type ExperimentalAgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  type AgentContext,
  createPromptBuilder,
  pb
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { GitTool } from '../tools/git-tool.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { getTemplateDescriptionPath, getModularPromptPaths, getValidatedTemplateVersion } from '../utils/prompt-utils.js'
import { AILibContextManager } from './ai-lib-agents/context-manager.js'

/**
 * Develop Agent - AI developer for building web applications
 */


// Initialize git tool and app repository for branch safety checks
const gitTool = new GitTool()
const appRepo = new AppRepository()

/**
 * Git branch safety hook (from original develop-agent)
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown, context?: AgentContext): Promise<unknown> => {
  console.log(`🔧 Develop Agent executing tool: ${toolName}`)
  
  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'terminalCommand', 'gitOperation']
  
  if (fileModifyingTools.includes(toolName)) {
    console.log(`⚠️  File-modifying tool detected: ${toolName}`)
    console.log(`🔍 Checking git branch state...`)
    
    try {
      // Extract appId from execution context
      const appId = context?.metadata?.appId as string
      if (!appId) {
        console.warn(`⚠️  No appId found in execution context, skipping git branch check for ${toolName}`)
        return args
      }
      
      // Look up app path using AppRepository
      const app = appRepo.findById(appId)
      if (!app) {
        console.error(`❌ App '${appId}' not found in repository, skipping git branch check for ${toolName}`)
        return args
      }
      
      const appPath = app.path
      console.log(`📁 Using app path: ${appPath}`)
      
      // Check current git branch using the actual git tool
      const branchResult = await gitTool.executeGitOperation(appPath, {
        operation: 'branch'
      })
      
      if (branchResult.success && branchResult.currentBranch) {
        const currentBranch = branchResult.currentBranch
        
        if (currentBranch !== 'main') {
          console.log(`⚠️  Before executing ${toolName}: Not on main branch (currently on: ${currentBranch}), attempting to return to main`)
          console.log(`🔄 Switching from '${currentBranch}' to 'main'`)
          
          // Execute git checkout main
          const checkoutResult = await gitTool.executeGitOperation(appPath, {
            operation: 'checkout',
            branch: 'main'
          })
          
          if (checkoutResult.success) {
            console.log(`✅ Successfully switched to main branch`)
          } else {
            console.warn(`⚠️  Failed to switch to main branch: ${checkoutResult.error}`)
            console.log(`🔄 Continuing with execution on ${currentBranch}`)
          }
        } else {
          console.log(`✅ Already on main branch, proceeding with ${toolName}`)
        }
      } else {
        console.warn(`⚠️  Could not determine current branch: ${branchResult.error || 'Unknown error'}`)
        console.log(`🔄 Continuing with execution despite error`)
      }
    } catch (error) {
      console.warn(`⚠️  Error checking git branch state before ${toolName} execution:`, error)
      console.log(`🔄 Continuing with execution despite error`)
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
  result: unknown,
  context?: AgentContext
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
  
  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url)
  
  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    //.file(paths.getAgentFile('develop', 'tools.md'))
    //.file(paths.getAgentFile('develop', 'database.md'))
    //.file(paths.getAgentFile('develop', 'api.md'))
    .file(paths.getAgentFile('develop', 'approach.md'))
    .file(paths.getAgentFile('develop', 'visual-context.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getAgentFile('develop', 'design.md'))
    .file(paths.getSharedFile('security.md'))
  
  // Template descriptions are now dynamically injected during conversation execution
  // via AILibContextManager.buildContextMessages() based on app context
  
  return await promptBuilder.build()
}

/**
 * Build dynamic system prompt with context enrichment
 */
async function buildDynamicSystemPrompt(context?: AgentContext): Promise<string> {
  console.log('🎯 Building dynamic system prompt with context:', {
    hasContext: !!context,
    contextKeys: context ? Object.keys(context) : [],
    hasMetadata: !!(context?.metadata),
    appId: context?.metadata?.appId
  })

  // Get the base static system prompt
  const baseSystemPrompt = await buildDevelopSystemPrompt()
  
  if (!context?.metadata?.appId) {
    console.log('⚠️ No appId in context, returning static system prompt')
    return baseSystemPrompt
  }

  try {
    // Use the context manager to build enhanced context
    const contextManager = new AILibContextManager()
    
    // Convert context to enhanced format
    const enhancedContext = contextManager.convertToEnhancedContext(context as any)
    
    // Build context messages
    const contextResult = await contextManager.buildContextMessages(baseSystemPrompt, enhancedContext)
    
    // Combine base system prompt with context messages
    const contextMessages = contextResult.contextMessages.map((msg: { role: 'user' | 'system'; content: string }) => msg.content).join('\n\n')
    
    const enrichedSystemPrompt = contextMessages ? 
      `${baseSystemPrompt}\n\n${contextMessages}` : baseSystemPrompt
    
    console.log('✅ Dynamic system prompt built:', {
      baseLength: baseSystemPrompt.length,
      contextMessagesCount: contextResult.contextMessages.length,
      totalLength: enrichedSystemPrompt.length,
      enriched: contextResult.contextMessages.length > 0
    })
    
    return enrichedSystemPrompt
  } catch (error) {
    console.error('❌ Failed to build dynamic system prompt, falling back to static:', error)
    return baseSystemPrompt
  }
}

/**
 * Create the Develop Agent configuration
 */
export async function createDevelopAgent(options?: { appPath?: string }): Promise<ExperimentalAgentConfig> {
  const appPath = options?.appPath || process.cwd()
  const systemPrompt = await buildDevelopSystemPrompt(appPath)
  const { model, modelName } = await getAgentModelWithName('full') // Use full model for complex development tasks
  
  return {
      name: 'AI Developer',
    system: systemPrompt,
    model,
    modelName,
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
        agentName: 'color-scheme',
        description: 'Color palette design and visual branding for applications',
      },
    ],
    
    maxSteps: 25,
    temperature: 0.3,
    maxOutputTokens: 8000
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