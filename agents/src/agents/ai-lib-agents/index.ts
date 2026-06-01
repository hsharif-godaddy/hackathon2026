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
  ExampleAgent,
  discoverNamedInitialVariants
} from '../index.js'
import { getTemplateIds } from '../template-registry.js'
import type { EnhancedAgentContext } from './types.js'
import { skillToolManager } from '../../tools/skill-tool-manager.js'
import { errorFields, logger } from '../../logging/index.js'
import { getProfileRegistry, runWithProfile, profileValue } from '../../profiles/index.js'
import { AgentContextPipeline } from './agent-context-pipeline.js'
import { setRegisteredInitialV3ModularAgentIds } from '../registered-initial-modular-agent-ids.js'
import { setRegisteredInitialNamedVariantIds } from '../registered-initial-named-variant-ids.js'
import { profileDefinesCustomModularPromptFiles } from '../modular-prompt-files.js'
import { resolveInitialVariantForProfileHandoff } from './initial-variant-resolution.js'

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

  // Pre-build develop variants for profiles that have develop.* or skill.* properties.
  // profileFlag() reads from AsyncLocalStorage, so we wrap each build in runWithProfile
  // so the flags resolve correctly at construction time.
  const profileDevelopConfigs: Record<string, AgentConfig> = {}
  for (const [name, profile] of getProfileRegistry()) {
    const hasDevelopFlags = Object.keys(profile.properties).some(k =>
      k.startsWith('develop.') || k.startsWith('skill.')
    )
    if (!hasDevelopFlags) continue

    try {
      const config = await runWithProfile(profile, () => createDevelopAgent())
      config.id = `develop-${name}`
      config.name = `AI Developer (${name})`
      profileDevelopConfigs[config.id] = config
    } catch (error) {
      logger.error('agent_factory.profile_develop_variant_failed', {
        profileName: name,
        ...errorFields(error),
      })
    }
  }

  const marketingConfig = await createMarketingAgent()
  const initialConfig = await createInitialAgent(stateManager)
  const initialV2Config = await createInitialAgent(stateManager, undefined, '2.0')
  initialV2Config.id = 'initial-v2'
  initialV2Config.name = 'Initial (v2.0)'

  const initialV3Config = await createInitialAgent(stateManager, undefined, '3.0')
  initialV3Config.id = 'initial-v3'
  initialV3Config.name = 'Initial (v3.0)'

  // Profile-specific modular prompt lists (endgame / Hivemind experiments)
  const profileInitialV3ModularConfigs: Record<string, AgentConfig> = {}
  for (const [name, profile] of getProfileRegistry()) {
    if (!profileDefinesCustomModularPromptFiles(profile)) continue
    try {
      const config = await runWithProfile(profile, () =>
        createInitialAgent(stateManager, undefined, '3.0'))
      config.id = `initial-v3-${name}`
      config.name = `Initial (v3.0 · ${name})`
      profileInitialV3ModularConfigs[config.id] = config
    } catch (error) {
      const variantId = `initial-v3-${name}`
      logger.error('agent_factory.profile_initial_modular_variant_failed', {
        profileName: name,
        variantId,
        ...errorFields(error),
      })
    }
  }

  // Pre-create template-specific initial agent variants
  const templateInitialConfigs: Record<string, AgentConfig> = {}
  for (const templateId of getTemplateIds()) {
    templateInitialConfigs[`initial-${templateId}`] = await createInitialAgent(stateManager, templateId)
  }

  // Pre-create named manifest variants (e.g. initial-prompt-enhancer). Each variant is
  // a sibling of the numbered versions under `agents/src/prompts/initial/<name>/` and is
  // selectable via a profile's `initial.promptVersion` property.
  const namedVariantInitialConfigs: Record<string, AgentConfig> = {}
  const namedVariantByVersion = new Map<string, string>()
  // Reserved agent ids that a named variant must not overwrite. Includes the
  // built-in initials, any pre-created template initials, and the modular v3
  // variant prefix. A variant directory named `v2` (→ `initial-v2`) or a
  // name colliding with a template id would otherwise silently replace the
  // built-in agent, making the bug invisible until request-time routing.
  const reservedInitialAgentIds = new Set<string>([
    'initial', 'initial-v2', 'initial-v3',
    ...Object.keys(templateInitialConfigs),
  ])
  for (const variantName of discoverNamedInitialVariants()) {
    try {
      // createInitialAgent assigns the correct `initial-<variantName>` id /
      // name internally when passed a non-numeric promptVersion, so the
      // handoff tool + telemetry logger reference the right agent.
      const config = await createInitialAgent(stateManager, undefined, variantName)
      const agentId = config.id
      if (!agentId) {
        // createInitialAgent always sets id; defensive narrow for the
        // optional AgentConfig.id type signature.
        throw new Error(`createInitialAgent returned config with no id for variant ${variantName}`)
      }
      if (reservedInitialAgentIds.has(agentId) || agentId.startsWith('initial-v3-')) {
        logger.error('agent_factory.initial_named_variant_id_collision', {
          variantName,
          agentId,
          message: 'Named variant directory name would override a reserved agent id; skipping registration. Rename the variant directory.',
        })
        continue
      }
      namedVariantInitialConfigs[agentId] = config
      namedVariantByVersion.set(variantName, agentId)
    } catch (error) {
      logger.error('agent_factory.initial_named_variant_build_failed', {
        variantName,
        ...errorFields(error),
      })
    }
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
  // Merge with any profile-gated stopAfterTools (e.g., askQuestion) set in develop-agent.ts
  const skillStopAfterTools = skillToolManager.getStopAfterToolNames()
  developConfig.stopAfterTools = [
    ...(developConfig.stopAfterTools ?? []),
    'handoff',
    'suggestedResponse',
    'requestSecrets',
    ...skillStopAfterTools,
  ]

  for (const config of Object.values(profileDevelopConfigs)) {
    config.tools = { ...(config.tools || {}), handoff: developHandoffTool }
    config.stopAfterTools = [
      ...(config.stopAfterTools ?? []),
      'handoff',
      'suggestedResponse',
      'requestSecrets',
      ...skillStopAfterTools,
    ]
  }

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
  marketingConfig.stopAfterTools = ['handoff', 'seoAnalysis', ...skillStopAfterTools]

  // For initial agent variants tied to profiles with develop flags, update the handoff
  // to target the develop variant instead of the default 'develop' agent.
  // This ensures the handoff continuation runs on the profile-specific develop agent.
  // NOTE: This mutates the shared initialV2Config/initialV3Config. If two profiles share
  // the same promptVersion AND both have develop.* flags, the last one wins. To support
  // that case, clone the initial config per profile before mutating.
  for (const [name, profile] of getProfileRegistry()) {
    const hasDevelopFlags = Object.keys(profile.properties).some(k =>
      k.startsWith('develop.') || k.startsWith('skill.')
    )
    if (!hasDevelopFlags) continue

    const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string))
    const modularVariantId = `initial-v3-${name}`
    const modularVariantBuilt = profileInitialV3ModularConfigs[modularVariantId]
    if (promptVersion === '2.0' && modularVariantBuilt) {
      logger.warn('agent_factory.profile_initial_modular_and_prompt_v2', {
        profileName: name,
        variantId: modularVariantId,
        message:
          'Handoff wiring uses initial v2 while the router may select the modular v3 variant; avoid both on one profile.',
      })
    }
    const initialVariantConfig = resolveInitialVariantForProfileHandoff({
      promptVersion,
      profileName: name,
      profileInitialV3ModularConfigs,
      namedVariantInitialConfigs,
      initialV2Config,
      initialV3Config,
    })
    if (!initialVariantConfig) continue
    if (!initialVariantConfig.id) {
      logger.error('agent_factory.initial_variant_missing_id', { profileName: name })
      continue
    }

    const developVariantId = `develop-${name}`
    const variantHandoffTool = createHandoffTool({
      sourceAgentId: initialVariantConfig.id,
      validTargets: [developVariantId],
      stateManager
    })
    initialVariantConfig.tools = { ...(initialVariantConfig.tools || {}), handoff: variantHandoffTool }
  }

  // Create shared pipeline for context assembly
  const contextPipeline = new AgentContextPipeline()
  developConfig.contextPipeline = contextPipeline
  for (const config of Object.values(profileDevelopConfigs)) {
    config.contextPipeline = contextPipeline
  }
  marketingConfig.contextPipeline = contextPipeline
  initialConfig.contextPipeline = contextPipeline
  initialV2Config.contextPipeline = contextPipeline
  initialV3Config.contextPipeline = contextPipeline

  for (const config of Object.values(profileInitialV3ModularConfigs)) {
    config.contextPipeline = contextPipeline
  }

  for (const config of Object.values(templateInitialConfigs)) {
    config.contextPipeline = contextPipeline
  }

  for (const config of Object.values(namedVariantInitialConfigs)) {
    config.contextPipeline = contextPipeline
  }

  // Build agent definitions conditionally
  const agentDefinitions: Record<string, AgentConfig> = {
    initial: initialConfig,
    'initial-v2': initialV2Config,
    'initial-v3': initialV3Config,
    ...profileInitialV3ModularConfigs,
    ...namedVariantInitialConfigs,
    develop: developConfig,
    ...profileDevelopConfigs,
    marketing: marketingConfig,
    ...templateInitialConfigs,
  }

  // Now define agents with handoff tools already included
  const agents = factory.defineAgents(agentDefinitions)

  // After agents exist in the factory — avoids routing to variant ids before defineAgents completes
  setRegisteredInitialV3ModularAgentIds(new Set(Object.keys(profileInitialV3ModularConfigs)))
  setRegisteredInitialNamedVariantIds(namedVariantByVersion)

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
