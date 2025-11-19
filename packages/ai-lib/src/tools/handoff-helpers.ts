/**
 * Handoff tool for agent switching
 * 
 * Creates a tool that allows agents to hand off control to other agents.
 * Unlike the delegate tool (which calls another agent and returns control),
 * the handoff tool actually switches the active agent handling the conversation.
 * 
 * This integrates with WebSocket server to switch which agent processes subsequent messages.
 */

import { createLogger } from '../utils/logger.js'
import { z } from 'zod'
import { createTool } from './index.js'
import type { AgentsCollection } from '../core/types.js'

const logger = createLogger('handoff-helpers')

/**
 * Handoff state manager interface
 * 
 * Applications (like WebSocket server) implement this to handle agent switching.
 */
export interface HandoffStateManager {
  /** Switch the active agent for a session */
  switchAgent: (sessionId: string, targetAgentId: string, prompt?: string) => Promise<boolean>
  /** Get the current agent for a session */
  getCurrentAgent?: (sessionId: string) => string | undefined
  /** Get the prompt from the last handoff (if any) */
  getLastHandoffPrompt?: (sessionId: string) => string | undefined
  /** Clear the last handoff prompt after it's been used */
  clearLastHandoffPrompt?: (sessionId: string) => void
}

/**
 * Handoff tool configuration
 */
export interface HandoffToolConfig {
  /** Current agent ID */
  sourceAgentId: string
  /** List of valid target agent IDs for this agent */
  validTargets: string[]
  /** Optional state manager for WebSocket integration */
  stateManager?: HandoffStateManager
  /** Session ID for WebSocket integration (can be string or function that returns sessionId from context) */
  sessionId?: string | ((context?: Record<string, unknown>) => string | undefined)
  /** Whether to validate handoff is allowed (default: true) */
  validateHandoff?: boolean
}

/**
 * Create a handoff tool for agent switching
 * 
 * Creates a tool that agents can use to hand off control to other agents.
 * This switches the active agent handling the conversation.
 * 
 * @param config - Handoff tool configuration
 * @returns Tool that can be used by agents to perform handoffs
 * 
 * @example
 * ```typescript
 * const factory = createAgentFactory()
 * const agents = factory.defineAgents({
 *   coordinator: {
 *     name: 'Coordinator',
 *     system: 'You coordinate tasks. Use handoff tool to switch to specialists.',
 *     model: await getModel('gpt4o'),
 *     tools: {
 *       handoff: createHandoffTool({
 *         agents,
 *         sourceAgentId: 'coordinator',
 *         sessionId: socketId // From WebSocket context
 *       })
 *     },
 *     handoffs: [
 *       { agentName: 'developer', description: 'Development tasks' }
 *     ]
 *   }
 * })
 * ```
 */
export function createHandoffTool(config: HandoffToolConfig) {
  const {
    sourceAgentId,
    validTargets,
    stateManager,
    sessionId,
    validateHandoff = true
  } = config

  return createTool(
    "Hand off control to another agent to handle the conversation. Don't say anything after the handoff, the next agent will take over.",
    z.object({
      targetAgent: z.string().describe(
        `ID of the agent to hand off to. Available: ${validTargets.join(', ')}`
      ),
      prompt: z.string().describe('Brief summary of what you completed. Do NOT add new instructions or tasks.')
    }),
    async ({ targetAgent, prompt }, context) => {
      logger.debug(`${sourceAgentId} initiating handoff to ${targetAgent}`)
      logger.debug(`Prompt: ${prompt}`)
      logger.debug(`Context keys: ${context ? Object.keys(context).join(', ') : 'no context'}`)
      logger.debug(`Context.socketId: ${(context as any)?.socketId}`)
      logger.debug(`Context.sessionId: ${(context as any)?.sessionId}`)
      
      // Filter out non-serializable properties from metadata for logging
      const metadata = (context as any)?.metadata
      if (metadata) {
        const serializableMetadata = Object.keys(metadata).reduce((acc, key) => {
          // Skip non-serializable objects like stateManager
          if (key === 'stateManager' || typeof metadata[key] === 'function') {
            acc[key] = '[Non-serializable]'
          } else {
            acc[key] = metadata[key]
          }
          return acc
        }, {} as Record<string, any>)
        logger.debug(`Context.metadata: ${JSON.stringify(serializableMetadata)}`)
      } else {
        logger.debug('Context.metadata: none')
      }

      // Validate handoff is allowed
      if (validateHandoff && !validTargets.includes(targetAgent)) {
        return {
          success: false,
          error: `Handoff to ${targetAgent} is not configured`,
          message: `Cannot hand off to ${targetAgent}. Available targets: ${validTargets.join(', ')}`,
          availableTargets: validTargets
        }
      }

      // Note: We don't validate agent existence here since agents are in context
      // The WebSocket server or application is responsible for ensuring agents exist

      // Resolve session ID (from config or agent context)
      let resolvedSessionId: string | undefined
      if (typeof sessionId === 'function') {
        resolvedSessionId = sessionId(context as Record<string, unknown> | undefined)
        logger.debug(`Resolved sessionId from function: ${resolvedSessionId}`)
      } else if (typeof sessionId === 'string') {
        resolvedSessionId = sessionId
        logger.debug(`Using sessionId from config: ${resolvedSessionId}`)
      } else if (context?.sessionId) {
        resolvedSessionId = context.sessionId as string
        logger.debug(`Using context.sessionId: ${resolvedSessionId}`)
      } else if (context?.metadata?.sessionId) {
        resolvedSessionId = context.metadata.sessionId as string
        logger.debug(`Using context.metadata.sessionId: ${resolvedSessionId}`)
      } else if ((context as any)?.socketId) {
        resolvedSessionId = (context as any).socketId
        logger.debug(`Using context.socketId: ${resolvedSessionId}`)
      }

      logger.debug(`Final resolved sessionId: ${resolvedSessionId}`)
      logger.debug(`Has stateManager: ${!!stateManager}`)

      // If state manager is provided (WebSocket integration), use it to switch agents
      if (stateManager && resolvedSessionId) {
        logger.info(`Calling stateManager.switchAgent(${resolvedSessionId}, ${targetAgent}, ${prompt.substring(0, 50)}...)`)
        try {
          const switched = await stateManager.switchAgent(resolvedSessionId, targetAgent, prompt)
          logger.info(`stateManager.switchAgent returned: ${switched}`)
          
          if (switched) {
            return {
              success: true,
              message: `Successfully handed off to ${targetAgent}. They will handle subsequent messages.`,
              targetAgent,
              prompt,
              timestamp: new Date().toISOString()
            }
          } else {
            return {
              success: false,
              error: 'State manager rejected handoff',
              message: `Failed to switch to ${targetAgent}`,
              targetAgent
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error(`Handoff error: ${errorMessage}`)
          
          return {
            success: false,
            error: errorMessage,
            message: `Handoff failed: ${errorMessage}`,
            targetAgent
          }
        }
      }

      // Without state manager or session ID, just return informational message
      return {
        success: true,
        message: `Handoff to ${targetAgent} recorded. Note: No state manager or session ID available, so agent won't actually switch in WebSocket context.`,
        targetAgent,
        prompt,
        timestamp: new Date().toISOString(),
        warning: 'No state manager or session ID - handoff recorded but not executed'
      }
    }
  )
}

/**
 * Helper function to add handoff tool to multiple agents
 * 
 * @param agents - Agents collection (used to extract handoff configurations)
 * @param agentIds - Array of agent IDs to add handoff tool to
 * @param stateManager - Optional state manager for WebSocket integration
 * @param getSessionId - Function to get session ID for each agent
 * @returns Object with handoff tools for each agent
 * 
 * @example
 * ```typescript
 * const factory = createAgentFactory()
 * const agents = factory.defineAgents({ ... })
 * 
 * // Add handoff tools to multiple agents
 * const handoffTools = addHandoffToolToAgents(
 *   agents,
 *   ['coordinator', 'developer'],
 *   stateManager,
 *   (agentId) => currentSessionId
 * )
 * 
 * // Use in agent configuration
 * agents.get('coordinator').tools = {
 *   ...agents.get('coordinator').tools,
 *   handoff: handoffTools.coordinator
 * }
 * ```
 */
export function addHandoffToolToAgents(
  agents: AgentsCollection,
  agentIds: string[],
  stateManager?: HandoffStateManager,
  getSessionId?: (agentId: string) => string | undefined
): Record<string, ReturnType<typeof createHandoffTool>> {
  const tools: Record<string, ReturnType<typeof createHandoffTool>> = {}
  
  for (const agentId of agentIds) {
    const sessionId = getSessionId?.(agentId)
    const agent = agents.get(agentId as any)
    const handoffs = agent.getConfig().handoffs || []
    const validTargets = handoffs.map((h: { agentName: string }) => h.agentName)
    
    tools[agentId] = createHandoffTool({
      sourceAgentId: agentId,
      validTargets,
      ...(stateManager && { stateManager }),
      ...(sessionId && { sessionId })
    })
  }
  
  return tools
}

/**
 * End conversation tool configuration
 */
export interface EndConversationToolConfig {
  /** Optional state manager for resetting to default agent */
  stateManager?: HandoffStateManager
  /** Session ID for WebSocket integration */
  sessionId?: string | ((context?: Record<string, unknown>) => string | undefined)
  /** Default agent ID to reset to (default: 'develop') */
  defaultAgentId?: string
}

/**
 * Create an end_conversation tool for completing conversations
 * 
 * This tool allows agents to signal that the conversation is complete
 * and optionally reset to the default agent. Use this when:
 * - A task is fully completed with no further action needed
 * - The agent is in "edit mode" (no active todo list) and has finished
 * - The user's request has been satisfied and no handoff is needed
 * 
 * @param config - Tool configuration
 * @returns Tool that ends the conversation
 */
export function createEndConversationTool(config: EndConversationToolConfig = {}) {
  const {
    stateManager,
    sessionId,
    defaultAgentId = 'develop'
  } = config

  const schema = z.object({
    summary: z.string().describe('Brief summary of what was completed (1-2 sentences)')
  })

  const toolInstance = createTool(
    'End the conversation after completing the task. Use this when you have finished the user\'s request and no further action or handoff is needed. This will reset to the default agent and signal completion.',
    schema,
    async (params: z.infer<typeof schema>, context?: any) => {
      const { summary } = params

      // Get session ID
      let currentSessionId: string | undefined
      if (typeof sessionId === 'function') {
        currentSessionId = sessionId(context)
      } else {
        currentSessionId = sessionId
      }

      // Reset to default agent if state manager is available
      if (stateManager && currentSessionId) {
        try {
          await stateManager.switchAgent(currentSessionId, defaultAgentId)
        } catch (error) {
          // Log but don't fail - the conversation is ending anyway
          logger.warn('Failed to reset to default agent', error)
        }
      }

      return {
        success: true,
        message: summary,
        conversationEnded: true
      }
    }
  )

  // Mark this tool as a stop tool
  return Object.assign(toolInstance, {
    stopAfterExecution: true
  })
}

