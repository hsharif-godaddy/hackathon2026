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
  createMarketingAgent,
  createInitialAgent,
  DevelopAgent,
  MarketingAgent,
  ExampleAgent
} from '../index.js'
import { getTemplateIds } from '../template-registry.js'
import type { EnhancedAgentContext } from './types.js'
import { skillToolManager } from '../../tools/skill-tool-manager.js'
import { AgentContextPipeline } from './agent-context-pipeline.js'

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
  // Initialize skill tool manager (pre-registers all skill tools)
  await skillToolManager.initialize()

  const factory = createAgentFactory({
    // skillToolProvider.getAllTools() is called internally by the factory
    skillToolProvider: skillToolManager
  })

  // Create or use provided state manager
  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'develop'
  })

  const developConfig = await createDevelopAgent()
  const marketingConfig = await createMarketingAgent()
  const initialConfig = await createInitialAgent(stateManager)

  // Pre-create template-specific initial agent variants
  const templateInitialConfigs: Record<string, AgentConfig> = {}
  for (const templateId of getTemplateIds()) {
    templateInitialConfigs[`initial-${templateId}`] = await createInitialAgent(stateManager, templateId)
  }

  // Create handoff tools BEFORE defining agents (using only agent IDs)
  // Extract valid targets from handoffs configuration
  const developHandoffTool = createHandoffTool({
    sourceAgentId: 'develop',
    validTargets: (developConfig.handoffs || []).map(h => h.agentName),
    stateManager
  })

  // End conversation tool created but not currently used in agent configs
  // Kept for future handoff completion functionality
  createEndConversationTool({
    stateManager,
    defaultAgentId: 'develop'
  })

  // Add handoff tools to agent configs BEFORE defining
  developConfig.tools = {
    ...(developConfig.tools || {}),
    handoff: developHandoffTool
  }
  // Stop execution after handoff, suggestedResponse, or secrets request tool is called
  // requestSecrets: Agent stops so secrets can be saved (auto or manual) before continuing
  developConfig.stopAfterTools = ['handoff', 'suggestedResponse', 'requestSecrets']

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

  // Create shared pipeline for context assembly
  const contextPipeline = new AgentContextPipeline()
  developConfig.contextPipeline = contextPipeline
  marketingConfig.contextPipeline = contextPipeline
  initialConfig.contextPipeline = contextPipeline

  for (const config of Object.values(templateInitialConfigs)) {
    config.contextPipeline = contextPipeline
  }

  // Build agent definitions conditionally
  const agentDefinitions: Record<string, AgentConfig> = {
    initial: initialConfig,
    develop: developConfig,
    marketing: marketingConfig,
    ...templateInitialConfigs,
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
  marketing: async (_context?: EnhancedAgentContext) => {
    const agent = new MarketingAgent()
    await agent.initialize()
    return agent.getAgent()
  },
  example: async (_context?: EnhancedAgentContext) => {
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
    description: 'An AI developer agent that helps build web applications, websites, and digital solutions. Specializes in full-stack development and modern web technologies.',
    version: '2.0.0',
    tags: ['developer', 'coding', 'web-development', 'ai-assistant', 'frontend'],
    toolGroups: ['core', 'system', 'media', 'debug'],
  },
  example: {
    id: 'example',
    name: 'Example Agent',
    description: 'A basic example agent for testing and demonstration purposes using AgentFactory.',
    version: '2.0.0',
    tags: ['example', 'demo', 'testing'],
    toolGroups: ['core'],
  },
  marketing: {
    id: 'marketing',
    name: 'Marketing Manager',
    description: 'SEO specialist and social media manager that helps optimize websites for better visibility and performance in search engines. Can connect to social platforms including Facebook and Instagram.',
    version: '1.0.0',
    tags: ['marketing', 'seo', 'content', 'optimization', 'search', 'social-media'],
    toolGroups: ['core', 'planning', 'content'],
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
  return Object.keys(aiLibAgentFactories)
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
