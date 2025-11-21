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
  createApiAgent,
  createDevelopAgent,
  createDatabaseAgent,
  createColorSchemeAgent,
  createMarketingAgent,
  createInitialAgent,
  createCommerceAgent,
  createExampleAgent,
  ApiAgent,
  DevelopAgent,
  DatabaseAgent,
  ColorSchemeAgent,
  MarketingAgent,
  CommerceAgent,
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
  const marketingConfig = await createMarketingAgent()
  const initialConfig = await createInitialAgent(stateManager)

  // Conditionally create database and api agents based on feature flag
  // API agent requires database agent (reads schemas), so both use same flag
  const isDatabaseAgentEnabled = featureAgents.isEnabled('database')
  const databaseConfig = isDatabaseAgentEnabled ? await createDatabaseAgent() : null
  const apiConfig = isDatabaseAgentEnabled ? await createApiAgent() : null

  // Conditionally create commerce agent based on feature flag
  const isCommerceAgentEnabled = featureAgents.isEnabled('commerce')
  const commerceConfig = isCommerceAgentEnabled ? await createCommerceAgent() : null

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
  // Stop execution after handoff or suggestedResponse tool is called
  developConfig.stopAfterTools = ['handoff', 'suggestedResponse']

  colorSchemeConfig.tools = {
    ...(colorSchemeConfig.tools || {}),
    handoff: colorSchemeHandoffTool,
    end_conversation: endConversationTool
  }
  // Stop execution after handoff, end_conversation, suggestedResponse, or cssSuggest tool is called
  colorSchemeConfig.stopAfterTools = ['handoff', 'end_conversation', 'suggestedResponse', 'cssSuggest']

  const marketingHandoffTool = createHandoffTool({
    sourceAgentId: 'marketing',
    validTargets: (marketingConfig.handoffs || []).map(h => h.agentName),
    stateManager
  })

  marketingConfig.tools = {
    ...(marketingConfig.tools || {}),
    handoff: marketingHandoffTool
  }
  // Stop execution after handoff tool is called
  marketingConfig.stopAfterTools = ['handoff']

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
    // Stop execution after handoff or suggestedResponse tool is called
    databaseConfig.stopAfterTools = ['handoff', 'suggestedResponse']
  }

  // Conditionally configure api agent if enabled
  if (apiConfig) {
    const apiHandoffTool = createHandoffTool({
      sourceAgentId: 'api',
      validTargets: (apiConfig.handoffs || []).map(h => h.agentName),
      stateManager
    })

    apiConfig.tools = {
      ...(apiConfig.tools || {}),
      handoff: apiHandoffTool
    }
    // Stop execution after handoff or suggestedResponse tool is called
    apiConfig.stopAfterTools = ['handoff', 'suggestedResponse']
  }

  // Build agent definitions conditionally
  const agentDefinitions: Record<string, AgentConfig> = {
    initial: initialConfig,
    develop: developConfig,
    'color-scheme': colorSchemeConfig,
    marketing: marketingConfig,
  }

  if (apiConfig) {
    agentDefinitions.api = apiConfig
  }

  if (databaseConfig) {
    agentDefinitions.database = databaseConfig
  }

  // Conditionally configure commerce agent if enabled
  if (commerceConfig) {
    const commerceHandoffTool = createHandoffTool({
      sourceAgentId: 'commerce',
      validTargets: (commerceConfig.handoffs || []).map(h => h.agentName),
      stateManager
    })

    commerceConfig.tools = {
      ...(commerceConfig.tools || {}),
      handoff: commerceHandoffTool
    }
    // Stop execution after handoff tool is called
    commerceConfig.stopAfterTools = ['handoff']

    agentDefinitions.commerce = commerceConfig
  }

  // Now define agents with handoff tools already included
  const agents = factory.defineAgents(agentDefinitions)

  return { factory, agents, stateManager }
}

/**
 * Agent factory functions for backward compatibility
 */
export const aiLibAgentFactories = {
  develop: async (_context?: EnhancedAgentContext) => {
    const agent = new DevelopAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  api: async (_context?: EnhancedAgentContext) => {
    const agent = new ApiAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  database: async (_context?: EnhancedAgentContext) => {
    const agent = new DatabaseAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  'color-scheme': async (_context?: EnhancedAgentContext) => {
    const agent = new ColorSchemeAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  marketing: async (_context?: EnhancedAgentContext) => {
    const agent = new MarketingAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  commerce: async (context?: EnhancedAgentContext) => {
    const agent = new CommerceAgent()
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
  initial: {
    id: 'initial',
    name: 'Initial Preview Builder',
    description: 'Creates a simple preview page for new apps to help users review and refine the style before building all features.',
    version: '1.0.0',
    tags: ['preview', 'initial', 'onboarding', 'planning'],
    toolGroups: ['core', 'planning'],
  },
  develop: {
    id: 'develop',
    name: 'AI Developer',
    description: 'An AI developer agent that helps build web applications, websites, and digital solutions. Specializes in full-stack development and modern web technologies. Orchestrates handoffs to specialized agents for database and API work.',
    version: '2.0.0',
    tags: ['developer', 'coding', 'web-development', 'ai-assistant', 'frontend', 'orchestration'],
    toolGroups: ['core', 'system', 'media', 'debug'],
  },
  api: {
    id: 'api',
    name: 'API Generator',
    description: 'Specialized agent for generating HTTP API routes using vite-plugin-api-routes. Reads database schemas and creates properly-typed RESTful endpoints with Express-style handlers.',
    version: '1.0.0',
    tags: ['api', 'backend', 'http', 'rest', 'endpoints', 'routes'],
    toolGroups: ['core', 'system', 'backend'],
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
    description: 'Specialized agent for MySQL database schema design and deployment using Drizzle ORM. Focuses exclusively on schema definition and deployment, not API generation.',
    version: '2.0.0',
    tags: ['database', 'mysql', 'schema', 'drizzle', 'backend'],
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
  marketing: {
    id: 'marketing',
    name: 'Marketing Manager',
    description: 'SEO specialist that helps optimize websites for better visibility and performance in search engines.',
    version: '1.0.0',
    tags: ['marketing', 'seo', 'content', 'optimization', 'search'],
    toolGroups: ['core', 'planning', 'content'],
  },
  commerce: {
    id: 'commerce',
    name: 'Commerce Agent',
    description: 'Specialized agent for GoDaddy Commerce product catalog operations. Fetches products from Commerce API and hands off to Develop Agent for HTML rendering.',
    version: '2.0.0',
    tags: ['commerce', 'e-commerce', 'products', 'catalog', 'godaddy'],
    toolGroups: ['commerce'],
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
    // Filter out api and database agents if database feature not enabled
    // API agent requires database agent (reads schemas), so both use same flag
    if (agentId === 'api' || agentId === 'database') {
      return featureAgents.isEnabled('database')
    }
    // Filter out commerce agent if not enabled
    if (agentId === 'commerce') {
      return featureAgents.isEnabled('commerce')
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
