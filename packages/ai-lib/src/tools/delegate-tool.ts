/**
 * Agent delegation tool for AgentFactory
 * 
 * This tool allows agents to delegate tasks to other agents with specific context.
 * The agent calls another agent, gets a response, and returns control to the caller.
 * This is NOT for switching the active agent - use handoff helpers for that.
 */

import { createLogger } from '../utils/logger.js'
import { z } from 'zod'
import { createTool } from './index.js'
import type { AgentFactory, HandoffContext } from '../core/agent-factory.js'

const logger = createLogger('delegate-tool')

/**
 * Create a delegate tool for an agent factory
 * 
 * Allows an agent to delegate a task to another agent and receive the result.
 * The calling agent remains in control after receiving the response.
 */
export function createDelegateTool(
  factory: AgentFactory,
  sourceAgentId: string
) {
  return createTool(
    'Delegate a task to another specialized agent and receive the result',
    z.object({
      targetAgent: z.string().describe('ID of the agent to delegate to (e.g., "database", "frontend", not display names)'),
      task: z.string().describe('Clear description of the task for the target agent'),
      context: z.record(z.any()).optional().describe('Additional context data to pass to the target agent'),
      parameters: z.record(z.any()).optional().describe('Parameters to pass to the target agent'),
      reason: z.string().optional().describe('Reason for the delegation')
    }),
    async ({ targetAgent, task, context, parameters, reason }) => {
      logger.info(`${sourceAgentId} delegating task to ${targetAgent}`)
      logger.info(`Task: ${task}`)
      
      const handoffContext: HandoffContext = {
        task,
        context,
        parameters,
        metadata: {
          sourceAgent: sourceAgentId,
          timestamp: new Date().toISOString(),
          ...(reason && { reason })
        }
      }

      try {
        const result = await factory.executeHandoff(
          sourceAgentId,
          targetAgent,
          handoffContext
        )

        if (result.success) {
          return {
            success: true,
            message: `Successfully delegated task to ${targetAgent}`,
            delegationId: result.handoffDetails.timestamp,
            result: result.result,
            targetAgent,
            task
          }
        } else {
          return {
            success: false,
            error: result.error,
            message: `Failed to delegate task to ${targetAgent}: ${result.error}`,
            targetAgent,
            task
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Delegation error: ${errorMessage}`)
        
        return {
          success: false,
          error: errorMessage,
          message: `Delegation failed: ${errorMessage}`,
          targetAgent,
          task
        }
      }
    }
  )
}

/**
 * Create a tool to view delegation history
 * 
 * Shows history of task delegations between agents.
 */
export function createDelegationHistoryTool(
  factory: AgentFactory,
  agentId?: string
) {
  return createTool(
    'View delegation history for this agent or all agents',
    z.object({
      agentFilter: z.string().optional().describe('Filter history for a specific agent'),
      limit: z.number().optional().describe('Limit number of entries returned'),
      status: z.enum(['pending', 'completed', 'failed']).optional().describe('Filter by delegation status')
    }),
    async ({ agentFilter, limit = 10, status }) => {
      let history = agentId 
        ? factory.getHandoffHistoryForAgent(agentId)
        : factory.getHandoffHistory()

      // Apply filters
      if (agentFilter) {
        history = history.filter(
          entry => entry.sourceAgent === agentFilter || entry.targetAgent === agentFilter
        )
      }

      if (status) {
        history = history.filter(entry => entry.status === status)
      }

      // Sort by timestamp (newest first) and limit
      history = history
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)

      return {
        success: true,
        history,
        totalEntries: history.length,
        message: `Retrieved ${history.length} delegation entries`
      }
    }
  )
}

/**
 * Helper to add delegation tools to an agent configuration
 * 
 * Adds the delegate tool and optionally the delegation history tool.
 */
export function addDelegationTools(
  factory: AgentFactory,
  agentId: string,
  includeHistory: boolean = true
) {
  const tools: Record<string, any> = {
    delegate: createDelegateTool(factory, agentId)
  }

  if (includeHistory) {
    tools.delegationHistory = createDelegationHistoryTool(factory, agentId)
  }

  return tools
}

/**
 * @deprecated Use addDelegationTools instead
 */
export function addHandoffTools(
  factory: AgentFactory,
  agentId: string,
  includeHistory: boolean = true
) {
  return addDelegationTools(factory, agentId, includeHistory)
}
