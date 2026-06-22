/**
 * Infrastructure Tool Detection
 *
 * Detects infrastructure tools (suggestedResponse, todoList) that represent
 * agent overhead rather than customer-requested work. These are always attributed
 * to GoDaddy regardless of success/failure.
 */

import { createLogger } from '@airo/ai-common'
import {
  getInfrastructureToolType,
  StepContentType,
  type ExecutionStep,
  type InfrastructureToolTypeName,
} from './types.js'

const logger = createLogger('infrastructure-detection')

/**
 * Extract correlation IDs for steps containing infrastructure tool calls.
 * Infrastructure tools are agent overhead (suggestedResponse, todoList)
 * that should always be attributed to GoDaddy.
 *
 * @param steps - Array of execution steps from onFinish
 * @returns Map of correlation IDs to their infrastructure tool category
 */
export function extractInfrastructureCalls(steps: ExecutionStep[]): Map<string, InfrastructureToolTypeName> {
  const infrastructureCalls = new Map<string, InfrastructureToolTypeName>()

  for (const step of steps) {
    const correlationId = step.response?.headers?.['x-correlation-id']
    if (!correlationId) continue

    // Check if any tool in this step is an infrastructure tool
    for (const item of step.content) {
      if (
        (item.type === StepContentType.ToolCall ||
          item.type === StepContentType.ToolResult ||
          item.type === StepContentType.ToolError) &&
        item.toolName
      ) {
        const toolType = getInfrastructureToolType(item.toolName)
        if (!toolType) continue

        infrastructureCalls.set(correlationId, toolType)
        logger.debug('infrastructure.tool.detected', {
          correlationId,
          toolName: item.toolName,
          toolType,
        })
        break // One infrastructure tool in a step is enough to mark it
      }
    }
  }

  logger.debug('infrastructure.detection.completed', {
    totalSteps: steps.length,
    totalInfrastructureCalls: infrastructureCalls.size,
    infrastructureCalls: Object.fromEntries(infrastructureCalls),
  })

  return infrastructureCalls
}

/** Extract correlation IDs for steps containing infrastructure tool calls. */
export function extractInfrastructureCallIds(steps: ExecutionStep[]): Set<string> {
  return new Set(extractInfrastructureCalls(steps).keys())
}
