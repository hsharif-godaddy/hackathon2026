/**
 * AI-Lib WebSocket Server Implementation
 * Updated to use ExperimentalAgentFactory system
 */

import { Server as HTTPServer } from 'http'
import { createExperimentalWebSocketServer } from '@airo/ai-lib'
import { 
  createWebSocketAgentFactory,
  aiLibAgentMetadata
} from '../agents/ai-lib-agents/index.js'
import { AgentsMessagePersistence } from './conversation-persistence.js'
import { logger } from '../logging/index.js'

/**
 * Create and setup the AI-Lib WebSocket server
 */
export async function setupAILibWebSocketServer(httpServer: HTTPServer) {
  console.log('🚀 Setting up ExperimentalAgentFactory WebSocket server with conversation persistence...')

  try {
    // Create the agent factory
    const agentFactory = await createWebSocketAgentFactory()
    
    // Create message persistence implementation
    const messagePersistence = new AgentsMessagePersistence()
    
    // Create the WebSocket server with the agent factory and built-in persistence
    const wsServer = createExperimentalWebSocketServer(httpServer, {
      agents: agentFactory.agents,
      
      // Built-in message persistence
      messagePersistence,
      
      // Context extractor to validate appId (still needed for validation)
      contextExtractor: (rawContext: Record<string, unknown>) => {
        // Extract appId from context metadata
        const metadata = rawContext.metadata as any
        const appId = metadata?.appId
        
        if (!appId || typeof appId !== 'string') {
          throw new Error('appId is required in context.metadata.appId')
        }
        
        console.log('✅ Validated appId:', appId)
        
        // Return the processed context (persistence will handle the rest)
        return rawContext
      },
      
      // Connection handler
      onConnection: (socketId: string) => {
        console.log('🔌 WebSocket client connected:', socketId)
      },
      
      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Message started
      },
      
      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        // Message completed
      },
      
      onDisconnection: (socketId: string) => {
        console.log('🔌 WebSocket client disconnected:', socketId)
      }
    })

    console.log('📡 ExperimentalAgentFactory WebSocket server ready for connections')
    console.log(`🎯 Available agents: ${agentFactory.getAvailableAgents().map(a => a.id).join(', ')}`)
    console.log(`🔧 Default agent: develop`)
    console.log(`📊 Agent count: ${agentFactory.getAgentCount()}`)
    console.log(`🌐 Multi-agent mode: ${agentFactory.isMultiAgentMode()}`)
    console.log(`🏭 Agent handoffs: enabled`)
    console.log(`🎨 Tool execution hooks: enabled`)
    console.log(`📋 Handoff history tracking: enabled`)
    console.log(`💾 Conversation persistence: enabled (built-in)`)

    // Log agent factory details
    const availableAgents = agentFactory.getAvailableAgents()
    console.log('📋 Agent details:')
    availableAgents.forEach(agent => {
      const metadata = aiLibAgentMetadata[agent.id]
      console.log(`  - ${agent.id}: ${agent.name}`)
      console.log(`    ${agent.description}`)
      if (metadata) {
        console.log(`    Tools: ${metadata.toolGroups.join(', ')}`)
        console.log(`    Tags: ${metadata.tags.join(', ')}`)
      }
    })

    return { wsServer, agentFactory }

  } catch (error) {
    console.error('❌ Failed to setup ExperimentalAgentFactory WebSocket server:', error)
    logger.error('WebSocket server setup failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

/**
 * Get WebSocket server info for health checks
 */
export function getWebSocketServerInfo() {
  return {
    agentIds: Object.keys(aiLibAgentMetadata),
    agentMetadata: aiLibAgentMetadata,
    defaultAgent: 'develop',
    totalAgents: Object.keys(aiLibAgentMetadata).length,
    serverType: 'ExperimentalAgentFactory',
    features: [
      'agent-handoffs',
      'tool-execution-hooks', 
      'handoff-history-tracking',
      'dynamic-system-prompts',
      'multi-agent-coordination'
    ]
  }
}
