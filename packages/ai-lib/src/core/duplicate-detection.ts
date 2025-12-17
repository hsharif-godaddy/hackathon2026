/**
 * Duplicate Response Detection for ToolLoopAgent
 *
 * Prevents infinite loops where the LLM returns the same response repeatedly,
 * which can cause token resource exhaustion.
 */

import { createLogger } from '../utils/logger.js'

const logger = createLogger('duplicate-detection')

/**
 * Default threshold for consecutive duplicate responses before stopping
 */
export const DEFAULT_DUPLICATE_RESPONSE_THRESHOLD = 2

/**
 * Type definition for step content items
 */
export interface StepContentItem {
  type: string
  text?: string
  toolName?: string
  input?: unknown
}

/**
 * Type definition for step result used in duplicate detection
 */
export interface StepResult {
  steps?: Array<{
    content?: StepContentItem[]
    finishReason?: string
  }>
}

/**
 * Build a signature from step content for comparison.
 * Includes both text content and tool calls (name + input).
 *
 * Note: We only track tool-call items, not tool-result items since
 * tool-result contains the output which we don't want to compare.
 *
 * @param content - Array of step content items
 * @returns A JSON string signature, or null if no meaningful content
 */
export function buildStepContentSignature(content: StepContentItem[]): string | null {
  const parts: string[] = []

  for (const item of content) {
    if (item.type === 'text' && item.text?.trim()) {
      parts.push(`text:${item.text.trim()}`)
    } else if (item.type === 'tool-call' && item.toolName) {
      // Include tool name and serialized input
      const inputStr = item.input ? JSON.stringify(item.input) : ''
      parts.push(`tool:${item.toolName}:${inputStr}`)
    }
    // Skip tool-result items - we only care about the tool-call inputs
  }

  // Return null if no meaningful content (edge case)
  // Note: We return null (not empty string) so callers can use `if (!signature)` check
  if (parts.length === 0) {
    return null
  }

  // Use JSON.stringify to avoid false positives from delimiter collisions
  // (e.g., tool args containing '|' characters)
  return JSON.stringify(parts)
}

/**
 * Creates a stop condition that detects consecutive duplicate text responses
 * from the LLM within a single agent execution loop.
 *
 * This prevents infinite loops where the LLM returns the same response repeatedly,
 * which can cause token resource exhaustion.
 *
 * @param threshold - Number of consecutive identical responses before stopping (default: 2)
 * @returns A stop condition function for ToolLoopAgent
 */
export function createDuplicateResponseStopCondition(
  threshold: number = DEFAULT_DUPLICATE_RESPONSE_THRESHOLD
): (result: unknown) => boolean {
  let lastStepSignature: string | undefined
  let consecutiveDuplicateCount = 0
  let lastStepCount = 0

  return (result: unknown): boolean => {
    // Type guard for result object - steps contain DefaultStepResult objects
    const typedResult = result as StepResult | undefined

    const steps = typedResult?.steps ?? []
    const currentStepCount = steps.length

    // Reset state if this appears to be a new execution (step count decreased or reset)
    // This handles the case where the same agent instance is reused for multiple calls
    if (currentStepCount < lastStepCount) {
      lastStepSignature = undefined
      consecutiveDuplicateCount = 0
    }
    lastStepCount = currentStepCount

    // Get the most recent step
    const lastStep = steps[steps.length - 1]
    if (!lastStep || !lastStep.content || lastStep.content.length === 0) {
      return false
    }

    // Build a signature from the step's content (both text and tool calls)
    // This catches both duplicate text responses AND duplicate tool call loops
    const contentSignature = buildStepContentSignature(lastStep.content)

    // Skip if we couldn't build a meaningful signature
    if (!contentSignature) {
      return false
    }

    // First step - just record it
    if (lastStepSignature === undefined) {
      lastStepSignature = contentSignature
      return false
    }

    // Check for duplicate step content
    if (contentSignature === lastStepSignature) {
      consecutiveDuplicateCount++

      // Determine what type of duplicate this is for logging
      const hasToolCalls = lastStep.content.some(item => item.type === 'tool-call')
      const hasText = lastStep.content.some(item => item.type === 'text' && item.text?.trim())

      const logData = {
        consecutiveCount: consecutiveDuplicateCount,
        threshold,
        stepCount: currentStepCount,
        duplicateType: hasToolCalls ? (hasText ? 'text_and_tools' : 'tool_calls') : 'text',
        signaturePreview: contentSignature.substring(0, 200)
      }

      if (consecutiveDuplicateCount >= threshold) {
        // Log at error level for monitoring/alerting
        logger.error('agent.loop.duplicate_response.stopped', {
          ...logData,
          message: 'Stopping agent loop due to consecutive duplicate step content to prevent resource exhaustion'
        })
        return true // Stop the loop
      }

      // Log at warn level for monitoring
      logger.warn('agent.loop.duplicate_response.detected', logData)
    } else {
      // Different step content - reset counter
      consecutiveDuplicateCount = 0
    }

    // Update signature for next comparison
    lastStepSignature = contentSignature
    return false
  }
}

