/**
 * Background Delegate Tool - Generic tool for delegating tasks to other agents
 *
 * This tool handles asynchronous background processing for all tasks. All tasks are
 * queued for background execution and processed sequentially, allowing later tasks
 * to reference results from earlier ones.
 */

import { createLogger } from '../utils/logger.js'
import type { Tool } from 'ai'
import { z } from 'zod'
import { createTool } from './index.js'
import type { AgentFactory } from '../core/agent-factory.js'
import { BackgroundQueue } from '../core/background-queue.js'

const logger = createLogger('background-delegate-tool')

/**
 * Create a background delegate tool for an agent factory
 *
 * Allows an agent to delegate tasks to another agent. All tasks are processed
 * asynchronously in the background and can reference previous results.
 *
 * @param factory - Agent factory for executing handoffs
 * @param sourceAgentId - ID of the agent using this tool
 * @param defaultTargetAgentId - Default target agent ID if not specified in tool call
 */
export function createBackgroundDelegateTool(
  factory: AgentFactory,
  sourceAgentId: string,
  defaultTargetAgentId?: string
): Tool {
  return createTool(
    'Delegate tasks to another agent. All tasks will be executed in the background and can reference previous results.',
    z.object({
      targetAgent: z.string().optional().describe('ID of the agent to delegate to (uses default if not provided)'),
      tasks: z.array(z.string()).min(1).describe('Array of tasks to execute in the background'),
      context: z.record(z.any()).optional().describe('Additional context data to pass to the target agent')
    }),
    async ({ targetAgent, tasks, context }, executionContext) => {
      const targetAgentId = targetAgent || defaultTargetAgentId

      if (!targetAgentId) {
        return {
          success: false,
          error: 'No target agent specified and no default target agent configured',
          message: 'Target agent is required'
        }
      }

      const totalTasks = tasks.length

      logger.info('Delegating tasks for background processing', {
        sourceAgent: sourceAgentId,
        targetAgent: targetAgentId,
        taskCount: totalTasks
      })
      logger.debug('Tasks queued', { tasks: tasks.map((t, i) => ({ index: i + 1, task: t })) })

      try {
        // Convert execution context to AgentContext format for BackgroundQueue
        const agentContext = executionContext ? {
          ...(executionContext.messages && { messages: executionContext.messages }),
          ...(executionContext.initialContextMessages && { initialContextMessages: executionContext.initialContextMessages }),
          ...(executionContext.sessionId && { sessionId: executionContext.sessionId as string }),
          ...(executionContext.userId && { userId: executionContext.userId as string }),
          ...(executionContext.metadata && { metadata: executionContext.metadata as Record<string, unknown> }),
          ...(executionContext.timestamp && { timestamp: executionContext.timestamp as Date }),
          ...(executionContext.files && { files: executionContext.files })
        } : {}

        // Create background queue and enqueue all tasks
        const backgroundQueue = new BackgroundQueue(factory, sourceAgentId, targetAgentId)

        logger.info('Queueing tasks for background processing', { taskCount: totalTasks })

        for (const taskToQueue of tasks) {
          backgroundQueue.enqueue(taskToQueue, agentContext, context)
            .catch(error => {
              logger.error('Background task failed', { task: taskToQueue, error })
            })
        }

        // Return immediately - all tasks are being processed in the background
        return {
          success: true,
          message: `${totalTasks} task(s) queued for background processing. Tasks will be executed sequentially and can reference previous results.`,
          tasksQueued: totalTasks,
          tasks,
          backgroundProcessing: true,
          note: 'All tasks are being processed in the background and will be available when ready.'
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Background delegation error', { error: errorMessage })

        return {
          success: false,
          error: errorMessage,
          message: `Background delegation failed: ${errorMessage}`,
          tasks
        }
      }
    }
  )
}

