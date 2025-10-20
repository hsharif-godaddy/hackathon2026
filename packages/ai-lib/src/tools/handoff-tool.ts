/**
 * Agent handoff tool for AgentFactory
 * 
 * This tool allows agents to hand off tasks to other agents with specific context.
 * The handoff includes only the provided context, not the full conversation history.
 */

import { z } from 'zod'
import { createTool } from './index.js'
import type { AgentFactory, HandoffContext } from '../core/agent-factory.js'

/**
 * Create a handoff tool for an agent factory
 */
export function createHandoffTool(
  factory: AgentFactory,
  sourceAgentId: string
) {
  return createTool(
    'Hand off a task to another specialized agent',
    z.object({
      targetAgent: z.string().describe('ID of the agent to hand off to (e.g., "database", "frontend", not display names)'),
      task: z.string().describe('Clear description of the task for the target agent'),
      context: z.record(z.any()).optional().describe('Additional context data to pass to the target agent'),
      parameters: z.record(z.any()).optional().describe('Parameters to pass to the target agent'),
      reason: z.string().optional().describe('Reason for the handoff')
    }),
    async ({ targetAgent, task, context, parameters, reason }) => {
      console.log(`🔄 ${sourceAgentId} initiating handoff to ${targetAgent}`)
      console.log(`📋 Task: ${task}`)
      
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
            message: `Successfully handed off task to ${targetAgent}`,
            handoffId: result.handoffDetails.timestamp,
            result: result.result,
            targetAgent,
            task
          }
        } else {
          return {
            success: false,
            error: result.error,
            message: `Failed to hand off task to ${targetAgent}: ${result.error}`,
            targetAgent,
            task
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`❌ Handoff error: ${errorMessage}`)
        
        return {
          success: false,
          error: errorMessage,
          message: `Handoff failed: ${errorMessage}`,
          targetAgent,
          task
        }
      }
    }
  )
}

/**
 * Create a tool to view handoff history
 */
export function createHandoffHistoryTool(
  factory: AgentFactory,
  agentId?: string
) {
  return createTool(
    'View handoff history for this agent or all agents',
    z.object({
      agentFilter: z.string().optional().describe('Filter history for a specific agent'),
      limit: z.number().optional().describe('Limit number of entries returned'),
      status: z.enum(['pending', 'completed', 'failed']).optional().describe('Filter by handoff status')
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
        message: `Retrieved ${history.length} handoff entries`
      }
    }
  )
}

/**
 * Helper to add handoff tools to an agent configuration
 */
export function addHandoffTools(
  factory: AgentFactory,
  agentId: string,
  includeHistory: boolean = true
) {
  const tools: Record<string, any> = {
    handoff: createHandoffTool(factory, agentId)
  }

  if (includeHistory) {
    tools.handoffHistory = createHandoffHistoryTool(factory, agentId)
  }

  return tools
}
