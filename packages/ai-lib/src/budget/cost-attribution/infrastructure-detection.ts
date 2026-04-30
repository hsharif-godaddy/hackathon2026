/**
 * Infrastructure Tool Detection
 *
 * Detects infrastructure tools (suggestedResponse, todoList) that represent
 * agent overhead rather than customer-requested work. These are always attributed
 * to GoDaddy regardless of success/failure.
 */

import { createLogger } from '@airo/ai-common'
import { isInfrastructureTool, StepContentType, type ExecutionStep } from './types.js'

const logger = createLogger('infrastructure-detection')

/**
 * Extract correlation IDs for steps containing infrastructure tool calls.
 * Infrastructure tools are agent overhead (suggestedResponse, todoList)
 * that should always be attributed to GoDaddy.
 *
 * @param steps - Array of execution steps from onFinish
 * @returns Set of correlation IDs for infrastructure tool calls
 */
export function extractInfrastructureCallIds(steps: ExecutionStep[]): Set<string> {
  const infrastructureCallIds = new Set<string>()

  for (const step of steps) {
    const correlationId = step.response?.headers?.['x-correlation-id']
    if (!correlationId) continue

    // Check if any tool in this step is an infrastructure tool
    for (const item of step.content) {
      if (
        (item.type === StepContentType.ToolCall || item.type === StepContentType.ToolResult) &&
        item.toolName &&
        isInfrastructureTool(item.toolName)
      ) {
        infrastructureCallIds.add(correlationId)
        logger.debug('infrastructure.tool.detected', {
          correlationId,
          toolName: item.toolName,
        })
        break // One infrastructure tool in a step is enough to mark it
      }
    }
  }

  logger.debug('infrastructure.detection.completed', {
    totalSteps: steps.length,
    totalInfrastructureCallIds: infrastructureCallIds.size,
    infrastructureCallIds: Array.from(infrastructureCallIds),
  })

  return infrastructureCallIds
}
