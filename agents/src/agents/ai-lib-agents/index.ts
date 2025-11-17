/**
 * AI-Lib Agent Factory - Updated for AgentFactory
 * Replaces the current BaseAgent inheritance pattern with AgentFactory composition
 * Enhanced with rich context support and agent handoffs
 */

import {
  createAgentFactory,
  type AgentFactory,
  type AgentConfig,
  createHandoffTool,
  createEndConversationTool,
  createSessionStateManager,
  type SessionStateManager
} from '@airo/ai-lib'
import {
  createDevelopAgent,
  createDatabaseAgent,
  createColorSchemeAgent,
  createExampleAgent,
  DevelopAgent,
  DatabaseAgent,
  ColorSchemeAgent,
  ExampleAgent
} from '../index.js'
import type { EnhancedAgentContext } from './types.js'
import { agents as featureAgents } from '../../services/features.js'

/**
 * Agent metadata for discovery and management
 */
export interface AILibAgentMetadata {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  toolGroups: string[]
}

/**
 * Create a unified agent factory with all agents
 */
export async function createUnifiedAgentFactory(options?: {
  stateManager?: SessionStateManager
}): Promise<{
  factory: AgentFactory
  agents: ReturnType<AgentFactory['defineAgents']>
  stateManager: SessionStateManager
}> {
  const factory = createAgentFactory({
    globalTools: []
  })
  
  // Create or use provided state manager
  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'develop',
    enableLogging: true
  })

  const developConfig = await createDevelopAgent()
  const colorSchemeConfig = await createColorSchemeAgent()

  // Conditionally create database agent based on feature flag
  const isDatabaseAgentEnabled = featureAgents.isEnabled('database')
  const databaseConfig = isDatabaseAgentEnabled ? await createDatabaseAgent() : null

  // Create handoff tools BEFORE defining agents (using only agent IDs)
  // Extract valid targets from handoffs configuration
  const developHandoffTool = createHandoffTool({
    sourceAgentId: 'develop',
    validTargets: (developConfig.handoffs || []).map(h => h.agentName),
    stateManager
  })

  const colorSchemeHandoffTool = createHandoffTool({
    sourceAgentId: 'color-scheme',
    validTargets: (colorSchemeConfig.handoffs || []).map(h => h.agentName),
    stateManager
  })

  const endConversationTool = createEndConversationTool({
    stateManager,
    defaultAgentId: 'develop'
  })

  // Add handoff tools to agent configs BEFORE defining
  developConfig.tools = {
    ...(developConfig.tools || {}),
    handoff: developHandoffTool
  }
  // Stop execution after handoff tool is called
  developConfig.stopAfterTools = ['handoff']

  colorSchemeConfig.tools = {
    ...(colorSchemeConfig.tools || {}),
    handoff: colorSchemeHandoffTool,
    end_conversation: endConversationTool
  }
  // Stop execution after handoff or end_conversation tool is called
  colorSchemeConfig.stopAfterTools = ['handoff', 'end_conversation']

  // Conditionally configure database agent if enabled
  if (databaseConfig) {
    const databaseHandoffTool = createHandoffTool({
      sourceAgentId: 'database',
      validTargets: (databaseConfig.handoffs || []).map(h => h.agentName),
      stateManager
    })

    databaseConfig.tools = {
      ...(databaseConfig.tools || {}),
      handoff: databaseHandoffTool
    }
    // Stop execution after handoff tool is called
    databaseConfig.stopAfterTools = ['handoff']
  }

  // Build agent definitions conditionally
  const agentDefinitions: Record<string, AgentConfig> = {
    develop: developConfig,
    'color-scheme': colorSchemeConfig,
  }

  if (databaseConfig) {
    agentDefinitions.database = databaseConfig
  }

  // Now define agents with handoff tools already included
  const agents = factory.defineAgents(agentDefinitions)
  
  return { factory, agents, stateManager }
}

/**
 * Agent factory functions for backward compatibility
 */
export const aiLibAgentFactories = {
  develop: async (context?: EnhancedAgentContext) => {
    const agent = new DevelopAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  database: async (context?: EnhancedAgentContext) => {
    const agent = new DatabaseAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  'color-scheme': async (context?: EnhancedAgentContext) => {
    const agent = new ColorSchemeAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  example: async (context?: EnhancedAgentContext) => {
    const agent = new ExampleAgent()
    await agent.initialize()
    return agent.getAgent()
  }
} as const

/**
 * Agent metadata registry
 */
export const aiLibAgentMetadata: Record<string, AILibAgentMetadata> = {
  develop: {
    id: 'develop',
    name: 'AI Developer',
    description: 'An AI developer agent that helps build web applications, websites, and digital solutions. Specializes in API generation from database schemas with flexible CRUD operations, full-stack development, and modern web technologies.',
    version: '2.0.0',
    tags: ['developer', 'coding', 'web-development', 'ai-assistant', 'api-generation', 'database', 'crud', 'backend'],
    toolGroups: ['core', 'system', 'backend', 'media', 'debug'],
  },
  example: {
    id: 'example',
    name: 'Example Agent',
    description: 'A basic example agent for testing and demonstration purposes using AgentFactory.',
    version: '2.0.0',
    tags: ['example', 'demo', 'testing'],
    toolGroups: ['core'],
  },
  database: {
    id: 'database',
    name: 'Database Manager',
    description: 'Specialized agent for MySQL database operations, user management, and backend server coordination.',
    version: '2.0.0',
    tags: ['database', 'mysql', 'backend', 'api'],
    toolGroups: ['core', 'system', 'backend'],
  },
  'color-scheme': {
    id: 'color-scheme',
    name: 'Color Scheme Designer',
    description: 'Interactive color palette designer that helps users create beautiful, accessible color schemes through guided discovery and visual selection.',
    version: '2.0.0',
    tags: ['design', 'color', 'ui', 'themes', 'accessibility'],
    toolGroups: ['core', 'planning', 'design'],
  },
}

/**
 * Create an agent by ID with enhanced context (backward compatibility)
 */
export async function createAgent(agentId: string, context?: EnhancedAgentContext) {
  const factory = aiLibAgentFactories[agentId as keyof typeof aiLibAgentFactories]
  
  if (!factory) {
    throw new Error(`Unknown agent ID: ${agentId}`)
  }
  
  return await factory(context)
}

/**
 * Get all available agent IDs (filtered by feature flags)
 */
export function getAvailableAgentIds(): string[] {
  const allAgentIds = Object.keys(aiLibAgentFactories)
  return allAgentIds.filter(agentId => {
    // Filter out database agent if not enabled
    if (agentId === 'database') {
      return featureAgents.isEnabled('database')
    }
    return true
  })
}

/**
 * Get agent metadata by ID
 */
export function getAgentMetadata(agentId: string): AILibAgentMetadata | undefined {
  return aiLibAgentMetadata[agentId]
}

/**
 * Get all agent metadata (filtered by feature flags)
 */
export function getAllAgentMetadata(): AILibAgentMetadata[] {
  const availableIds = getAvailableAgentIds()
  return Object.values(aiLibAgentMetadata).filter(metadata =>
    availableIds.includes(metadata.id)
  )
}

/**
 * Find agents by tag
 */
export function findAgentsByTag(tag: string): AILibAgentMetadata[] {
  return Object.values(aiLibAgentMetadata).filter(metadata => 
    metadata.tags.includes(tag)
  )
}

/**
 * Search agents by name or description
 */
export function searchAgents(query: string): AILibAgentMetadata[] {
  const lowerQuery = query.toLowerCase()
  return Object.values(aiLibAgentMetadata).filter(metadata =>
    metadata.name.toLowerCase().includes(lowerQuery) ||
    metadata.description.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Create WebSocket-compatible agent factory
 */
export async function createWebSocketAgentFactory(options?: {
  stateManager?: SessionStateManager
}) {
  const { factory, agents, stateManager } = await createUnifiedAgentFactory(options)
  
  return {
    factory,
    agents,
    stateManager,
    // WebSocket server compatibility methods
    getAgent: (id: string) => agents.get(id as any),
    getAvailableAgents: () => getAvailableAgentIds().map(id => ({
      id,
      name: aiLibAgentMetadata[id]?.name || id,
      description: aiLibAgentMetadata[id]?.description || ''
    })),
    getAgentCount: () => getAvailableAgentIds().length,
    isMultiAgentMode: () => true
  }
}