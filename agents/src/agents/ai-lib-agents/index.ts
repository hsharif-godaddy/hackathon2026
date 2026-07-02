/**
 * AI-Lib Agent Factory - Updated for AgentFactory
 * Replaces the current BaseAgent inheritance pattern with AgentFactory composition
 * Enhanced with rich context support and agent handoffs
 */

import {
  createAgentFactory,
  type AgentFactory,
  type AgentConfig,
  createEndConversationTool,
  createSessionStateManager,
  type SessionStateManager
} from '@airo/ai-lib'
import {
  createDevelopAgent,
  createMarketingAgent,
  createInitialAgent,
  createDebugAgent,
  discoverNamedInitialVariants
} from '../index.js'
import { createAgentHandoffTool } from '../../tools/create-agent-handoff-tool.js'
import { createDeepBuildAgent } from '../deep-build-agent.js'
import { getModeIds } from '../mode-registry.js'
import { skillToolManager } from '../../tools/skill-tool-manager.js'
import { errorFields, logger } from '../../logging/index.js'
import { getProfileRegistry, runWithProfile, profileValue } from '../../profiles/index.js'
import { AgentContextPipeline } from './agent-context-pipeline.js'
import { setRegisteredInitialNamedVariantIds } from '../registered-initial-named-variant-ids.js'

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

  const debugConfig = await createDebugAgent()
  const marketingConfig = await createMarketingAgent()
  const deepBuildConfig = await createDeepBuildAgent()
  const initialConfig = await createInitialAgent(stateManager)

  const initialV3Config = await createInitialAgent(stateManager, undefined, '3.0')
  initialV3Config.id = 'initial-v3'
  initialV3Config.name = 'Initial (v3.0)'

  // Pre-create template-specific initial agent variants
  const modeInitialConfigs: Record<string, AgentConfig> = {}
  for (const templateId of getModeIds()) {
    modeInitialConfigs[`initial-${templateId}`] = await createInitialAgent(stateManager, templateId)
  }

  // Pre-create named manifest variants (e.g. initial-prompt-enhancer). Each variant is
  // a sibling of the numbered versions under `agents/src/prompts/initial/<name>/` and is
  // selectable via a profile's `initial.promptVersion` property.
  const namedVariantInitialConfigs: Record<string, AgentConfig> = {}
  const namedVariantByVersion = new Map<string, string>()
  // Reserved agent ids that a named variant must not overwrite. Includes the
  // built-in initials, any pre-created template initials, and the modular v3
  // variant prefix. A variant directory name colliding with a template id
  // would otherwise silently replace the built-in agent, making the bug
  // invisible until request-time routing.
  const reservedInitialAgentIds = new Set<string>([
    'initial', 'initial-v3',
    ...Object.keys(modeInitialConfigs),
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
  const developHandoffTool = createAgentHandoffTool({
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

  developConfig.tools = {
    ...(developConfig.tools || {}),
    handoff: developHandoffTool
  }
  const skillStopAfterTools = skillToolManager.getStopAfterToolNames()
  developConfig.stopAfterTools = [
    ...(developConfig.stopAfterTools ?? []),
    'handoff',
    'suggestedResponse',
    'requestSecrets',
    ...skillStopAfterTools,
  ]

  const marketingHandoffTool = createAgentHandoffTool({
    sourceAgentId: 'marketing',
    validTargets: (marketingConfig.handoffs || []).map(h => h.agentName),
    stateManager
  })

  marketingConfig.tools = {
    ...(marketingConfig.tools || {}),
    handoff: marketingHandoffTool
  }
  // Stop execution after handoff tool is called
  marketingConfig.stopAfterTools = ['handoff', 'seoAnalysis', ...skillStopAfterTools, 'suggestedResponse', 'askQuestion']

  const contextPipeline = new AgentContextPipeline()
  developConfig.contextPipeline = contextPipeline
  marketingConfig.contextPipeline = contextPipeline
  initialConfig.contextPipeline = contextPipeline
  initialV3Config.contextPipeline = contextPipeline

  for (const config of Object.values(modeInitialConfigs)) {
    config.contextPipeline = contextPipeline
  }

  for (const config of Object.values(namedVariantInitialConfigs)) {
    config.contextPipeline = contextPipeline
  }

  deepBuildConfig.contextPipeline = contextPipeline

  // Build agent definitions conditionally
  const agentDefinitions: Record<string, AgentConfig> = {
    initial: initialConfig,
    'initial-v3': initialV3Config,
    ...namedVariantInitialConfigs,
    develop: developConfig,
    marketing: marketingConfig,
    debug: debugConfig,
    'deep-build': deepBuildConfig,
    ...modeInitialConfigs,
  }

  // Now define agents with handoff tools already included
  const agents = factory.defineAgents(agentDefinitions)

  setRegisteredInitialNamedVariantIds(namedVariantByVersion)

  return { factory, agents, stateManager }
}

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
    isMultiAgentMode: () => true
  }
}
