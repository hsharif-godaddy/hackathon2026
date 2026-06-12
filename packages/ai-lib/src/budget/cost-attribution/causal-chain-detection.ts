/**
 * Causal Chain Detection Module
 *
 * Detects when the agent breaks something mid-execution and then fixes it.
 * Only the calls involved in the chain are attributed to GoDaddy — not the entire execution.
 *
 * Pattern:
 * Edit(file.tsx) ──────────────────┐
 *        │                         │
 *        ▼                         │ CAUSAL CHAIN
 * Command fails ───────────────────┤ (all calls → GoDaddy)
 *        │  (error mentions file)  │
 *        ▼                         │
 * Read/Edit to fix ────────────────┤
 *        │                         │
 *        ▼                         │
 * Command succeeds ────────────────┘
 */

import { createLogger } from '@airo/ai-common'
import {
  classifyFileOp,
  isFileTool,
  StepContentType,
  getToolInput,
  type ExecutionStep,
  type CausalChain,
  type StepContentItem,
} from './types.js'
import { getCorrelationId, hasWordBoundaryMatch } from './failure-extraction.js'

const logger = createLogger('causal-chain-detection')

// EXTRACTION HELPERS

function extractFilePath(args: unknown): string {
  if (!args || typeof args !== 'object') return 'unknown'
  const obj = args as Record<string, unknown>
  return String(obj.path ?? obj.file_path ?? obj.filePath ?? 'unknown')
}

function extractErrorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.stderr === 'string') return obj.stderr
    if (typeof obj.stdout === 'string') return obj.stdout
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

// CAUSAL RELATIONSHIP DETECTION

/**
 * Check if an error message mentions a target file.
 * This establishes the causal relationship between an edit and a subsequent error.
 *
 * Uses word-boundary matching to avoid false positives where short filenames
 * match inside longer words (e.g., "api.ts" matching inside "rapids.tsx").
 */
function errorMentionsTarget(errorText: string, filePath: string): boolean {
  const errorLower = errorText.toLowerCase()

  // Check for filename (last segment of path) with word boundary
  const filename = filePath.split('/').pop()?.toLowerCase()
  if (filename && filename.length > 2) {
    // Strip extension and check filename without it (handles "api" vs "api.ts")
    const nameWithoutExt = filename.replace(/\.(tsx?|jsx?|css|json|md|html|scss|less)$/, '')
    if (nameWithoutExt.length > 2 && hasWordBoundaryMatch(errorLower, nameWithoutExt)) {
      return true
    }
    // Also check full filename for specific references
    if (hasWordBoundaryMatch(errorLower, filename)) {
      return true
    }
  }

  // Check for path segments with word boundary (filter out short segments)
  const pathSegments = filePath
    .toLowerCase()
    .split('/')
    .filter(s => s.length > 3)
  if (pathSegments.some(seg => hasWordBoundaryMatch(errorLower, seg))) {
    return true
  }

  return false
}

/**
 * Check if a step content item operates on a specific file.
 */
function operationTargetsFile(item: StepContentItem, targetFile: string): boolean {
  if (!item.toolName || !isFileTool(item.toolName)) return false

  const filePath = extractFilePath(getToolInput(item))
  if (filePath === 'unknown') return false

  // Check if the operation's file matches the target
  const targetFilename = targetFile.split('/').pop()?.toLowerCase()
  const opFilename = filePath.split('/').pop()?.toLowerCase()

  if (filePath === targetFile) return true
  if (targetFilename && opFilename && targetFilename === opFilename) return true
  return false
}

/**
 * Find the step index for a given correlation ID.
 */
function findStepIdxByCallId(steps: ExecutionStep[], callId: string): number {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step && getCorrelationId(step) === callId) {
      return i
    }
  }
  return -1
}

/**
 * Get the tool name from the error step to check for verification.
 */
function getErrorToolName(steps: ExecutionStep[], errorCallId: string): string | undefined {
  const stepIdx = findStepIdxByCallId(steps, errorCallId)
  if (stepIdx === -1) return undefined

  const step = steps[stepIdx]
  if (!step) return undefined
  const content = step.content ?? []
  for (const item of content) {
    if (item.type === StepContentType.ToolError && item.toolName) {
      return item.toolName
    }
  }
  return undefined
}

// MAIN DETECTION

interface RecentEdit {
  callId: string
  filePath: string
  stepIdx: number
}

/** Internal chain representation using Set for O(1) lookups */
interface InternalChain {
  triggerCallId: string
  triggerTarget: string
  errorCallId: string
  errorMessage: string
  fixCallIds: Set<string>
  verificationCallId?: string
}

/**
 * Detect causal chains where an edit causes an error that is then fixed.
 *
 * Detection logic:
 * 1. Track all successful edits with their file paths
 * 2. When a tool error occurs, check if the error text mentions a recently edited file
 * 3. If so, track subsequent operations on that file as "fix" work
 * 4. If the same type of command succeeds later, mark it as verification
 *
 * @param steps - Array of SDK execution steps
 * @returns Array of detected causal chains
 */
export function detectCausalChains(steps: ExecutionStep[]): CausalChain[] {
  const chains: InternalChain[] = []

  // Track recent successful edits with their targets
  const recentEdits: RecentEdit[] = []

  // First pass: identify potential chains
  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx]
    if (!step) continue
    const callId = getCorrelationId(step)
    if (!callId) continue

    const content = step.content ?? []
    for (const item of content) {
      // Track successful edits (keep only last 10 - we only check within 5 steps anyway).
      // classifyFileOp is command-aware: the editor's `view` is a read, not an
      // edit, so viewing a file no longer counts as a chain trigger.
      if (
        item.type === StepContentType.ToolResult &&
        item.toolName &&
        classifyFileOp(item.toolName, getToolInput(item)) === 'edit'
      ) {
        const filePath = extractFilePath(getToolInput(item))
        if (filePath !== 'unknown') {
          recentEdits.push({ callId, filePath, stepIdx })
          // Prune old edits that can never match (outside the 5-step window)
          while (recentEdits.length > 10) {
            recentEdits.shift()
          }
        }
      }

      // Check if error is causally related to a recent edit
      if (item.type === StepContentType.ToolError) {
        const errorText = extractErrorText(item.error)

        // Look for causal connection: error mentions recently edited file
        // Only check edits from the last 5 steps to avoid false positives
        // Reverse to check most recent edits first (recentEdits is oldest-first)
        const recentWindow = recentEdits.filter(edit => stepIdx - edit.stepIdx <= 5).reverse()

        for (const edit of recentWindow) {
          if (errorMentionsTarget(errorText, edit.filePath)) {
            // Found causal relationship - start tracking chain (most recent edit wins)
            chains.push({
              triggerCallId: edit.callId,
              triggerTarget: edit.filePath,
              errorCallId: callId,
              errorMessage: errorText.slice(0, 200),
              fixCallIds: new Set(),
            })
            break // One error can only be caused by one edit (take the most recent)
          }
        }
      }
    }
  }

  // Second pass: identify fix attempts and verification
  for (const chain of chains) {
    const errorStepIdx = findStepIdxByCallId(steps, chain.errorCallId)
    if (errorStepIdx === -1) continue

    const errorToolName = getErrorToolName(steps, chain.errorCallId)

    for (let i = errorStepIdx + 1; i < steps.length; i++) {
      const step = steps[i]
      if (!step) continue
      const callId = getCorrelationId(step)
      if (!callId) continue

      const content = step.content ?? []
      for (const item of content) {
        // Any operation on the triggered file is part of the fix
        if (operationTargetsFile(item, chain.triggerTarget)) {
          chain.fixCallIds.add(callId)
        }

        // Same tool type succeeding = verification (chain complete)
        // Note: verification is NOT added to fixCallIds - it's a distinct role
        // For file tools, we also require the operation to target the same file to avoid
        // false positives where an unrelated file operation with the same tool name succeeds.
        // For non-file tools (like terminal/bash), success of the same command type is sufficient.
        if (
          item.type === StepContentType.ToolResult &&
          item.toolName &&
          errorToolName &&
          item.toolName.toLowerCase() === errorToolName.toLowerCase()
        ) {
          // For file tools, verify same target; for non-file tools, any success counts
          const isFileToolVerification = isFileTool(item.toolName)
          if (!isFileToolVerification || operationTargetsFile(item, chain.triggerTarget)) {
            chain.verificationCallId = callId
          }
        }
      }

      // Stop attributing to chain after verification is found
      // Subsequent work on the file is legitimate, not part of the fix
      if (chain.verificationCallId) {
        break
      }
    }
  }

  // Convert internal Sets to arrays for the public interface
  const result: CausalChain[] = chains.map(chain => {
    const base = {
      triggerCallId: chain.triggerCallId,
      triggerTarget: chain.triggerTarget,
      errorCallId: chain.errorCallId,
      errorMessage: chain.errorMessage,
      fixCallIds: [...chain.fixCallIds],
    }
    // Only include verificationCallId if it's defined (exactOptionalPropertyTypes)
    if (chain.verificationCallId) {
      return { ...base, verificationCallId: chain.verificationCallId }
    }
    return base
  })

  if (result.length > 0) {
    logger.debug('causal_chain.detected', {
      chainCount: result.length,
      chains: result.map(c => ({
        triggerTarget: c.triggerTarget,
        errorMessage: c.errorMessage.slice(0, 80),
        fixCallCount: c.fixCallIds.length,
        hasVerification: !!c.verificationCallId,
      })),
    })
  } else {
    logger.debug('causal_chain.none_detected', {
      recentEditsTracked: recentEdits.length,
    })
  }

  return result
}

/**
 * Get all call IDs from causal chains for GoDaddy attribution.
 * Includes trigger, error, and fix calls.
 *
 * Note: verificationCallId is intentionally EXCLUDED.
 * Verification confirms the fix worked and delivers value to the customer,
 * so the customer should pay for that step; they should not pay for the error chain.
 */
export function getCausalChainCallIds(chains: CausalChain[]): Set<string> {
  const callIds = new Set<string>()

  for (const chain of chains) {
    callIds.add(chain.triggerCallId)
    callIds.add(chain.errorCallId)
    for (const fixId of chain.fixCallIds) {
      callIds.add(fixId)
    }
    // Note: verificationCallId intentionally excluded
    // Verification = value delivered = customer pays
  }

  return callIds
}
