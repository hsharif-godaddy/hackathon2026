/**
 * AI-Lib Agent Factory - Updated for ExperimentalAgentFactory
 * Replaces the current BaseAgent inheritance pattern with ExperimentalAgentFactory composition
 * Enhanced with rich context support and agent handoffs
 */

import { 
  createExperimentalAgentFactory,
  type ExperimentalAgentFactory,
  type ExperimentalAgentConfig
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
export async function createUnifiedAgentFactory(): Promise<{
  factory: ExperimentalAgentFactory
  agents: ReturnType<ExperimentalAgentFactory['defineAgents']>
}> {
  const factory = createExperimentalAgentFactory()
  
  const agents = factory.defineAgents({
    develop: await createDevelopAgent(),
    database: await createDatabaseAgent(),
    'color-scheme': await createColorSchemeAgent(),
    example: await createExampleAgent()
  })
  
  return { factory, agents }
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
    description: 'A basic example agent for testing and demonstration purposes using ExperimentalAgentFactory.',
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
 * Get all available agent IDs
 */
export function getAvailableAgentIds(): string[] {
  return Object.keys(aiLibAgentFactories)
}

/**
 * Get agent metadata by ID
 */
export function getAgentMetadata(agentId: string): AILibAgentMetadata | undefined {
  return aiLibAgentMetadata[agentId]
}

/**
 * Get all agent metadata
 */
export function getAllAgentMetadata(): AILibAgentMetadata[] {
  return Object.values(aiLibAgentMetadata)
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
export async function createWebSocketAgentFactory() {
  const { factory, agents } = await createUnifiedAgentFactory()
  
  return {
    factory,
    agents,
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