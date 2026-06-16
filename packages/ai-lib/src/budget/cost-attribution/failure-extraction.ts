/**
 * Failure Extraction Utilities
 *
 * Extracts failed call IDs and failed targets from SDK execution steps.
 * This is the first layer of cost attribution - direct tool failures.
 */

import { createLogger } from '@airo/ai-common'
import {
  FILE_TOOLS,
  TERMINAL_TOOLS,
  SEARCH_TOOLS,
  StepContentType,
  getToolInput,
  getToolOutput,
  type ExecutionStep,
  type StepContentItem,
} from './types.js'

const logger = createLogger('failure-extraction')

/**
 * Header name for GoCode correlation ID.
 * This ID matches BMS sessionItems[].callRequestId for cost attribution.
 */
const CORRELATION_ID_HEADER = 'x-correlation-id'

/**
 * Extract correlation ID from step response headers.
 * The x-correlation-id header links SDK steps to BMS session items.
 */
export function getCorrelationId(step: ExecutionStep): string | undefined {
  return step.response?.headers?.[CORRELATION_ID_HEADER]
}

/**
 * Check if a step content item is a tool error (explicit SDK error).
 */
function isToolError(item: StepContentItem): boolean {
  return item.type === StepContentType.ToolError
}

/**
 * Parse JSON-string tool output into an object when tools return
 * `JSON.stringify(...)` instead of structured output.
 */
function normalizeToolOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output
  try {
    return JSON.parse(output)
  } catch {
    return output
  }
}

/**
 * Get normalized tool output from a step content item.
 */
export function getNormalizedToolOutput(item: StepContentItem): unknown {
  return normalizeToolOutput(getToolOutput(item))
}

function nonzeroExitCode(exitCode: unknown): boolean {
  if (typeof exitCode === 'number') return exitCode !== 0
  if (typeof exitCode === 'string' && exitCode.trim() !== '') {
    const parsed = Number(exitCode)
    return Number.isFinite(parsed) && parsed !== 0
  }
  return false
}

function extractFailureText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.error === 'string') return obj.error
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.stderr === 'string') return obj.stderr
    if (typeof obj.stdout === 'string') return obj.stdout

    return ''
  }
  return String(error)
}

/**
 * Extract error text from a hard or soft tool failure.
 */
export function getToolFailureText(item: StepContentItem): string {
  if (item.type === StepContentType.ToolError) return extractFailureText(item.error)
  return extractFailureText(getNormalizedToolOutput(item))
}

/**
 * Check if a tool-result contains a soft failure.
 * Explicit `success` wins; exitCode is a fallback for tools that do not set it.
 * Catches tools that handle errors internally and return a result
 * instead of throwing — invisible to tool-error detection.
 */
export function isSoftToolFailure(item: StepContentItem): boolean {
  if (item.type !== StepContentType.ToolResult) return false
  const output = getNormalizedToolOutput(item)
  if (!output || typeof output !== 'object') return false
  const obj = output as Record<string, unknown>
  if (typeof obj.success === 'boolean') return obj.success === false
  return nonzeroExitCode(obj.exitCode)
}

/**
 * Check if a step content item represents a failure (hard or soft).
 */
export function isToolFailure(item: StepContentItem): boolean {
  return isToolError(item) || isSoftToolFailure(item)
}

/**
 * Extract the set of correlation IDs for steps that had tool errors.
 *
 * @param steps - Array of SDK execution steps
 * @returns Set of correlation IDs for failed calls
 */
export function extractFailedCallIds(steps: ExecutionStep[]): Set<string> {
  const failedCallIds = new Set<string>()
  let stepsWithoutCorrelationId = 0
  let hardErrors = 0
  let softFailures = 0

  for (const step of steps) {
    const callId = getCorrelationId(step)
    if (!callId) {
      stepsWithoutCorrelationId++
      continue
    }

    const content = step.content ?? []
    const hasHardError = content.some(isToolError)
    const hasSoftFailure = content.some(isSoftToolFailure)

    if (hasHardError || hasSoftFailure) {
      failedCallIds.add(callId)
      if (hasHardError) hardErrors++
      if (hasSoftFailure) softFailures++
    }
  }

  logger.info('failure_extraction.call_ids', {
    totalSteps: steps.length,
    failedCallIds: failedCallIds.size,
    hardErrors,
    softFailures,
    stepsWithoutCorrelationId,
    ids: Array.from(failedCallIds),
  })

  if (stepsWithoutCorrelationId > 0) {
    logger.warn('failure_extraction.missing_correlation_ids', {
      count: stepsWithoutCorrelationId,
      totalSteps: steps.length,
    })
  }

  return failedCallIds
}

/**
 * Extract file path from tool arguments.
 * Handles common patterns: path, file_path, filePath
 */
function extractFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const obj = args as Record<string, unknown>
  const path = obj.path ?? obj.file_path ?? obj.filePath
  return typeof path === 'string' ? path : undefined
}

/**
 * Extract command from terminal tool arguments.
 */
function extractCommand(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const obj = args as Record<string, unknown>
  const command = obj.command
  return typeof command === 'string' ? command.split(' ')[0] : undefined
}

/**
 * Extract search query from grep/search tool arguments.
 */
function extractSearchQuery(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const obj = args as Record<string, unknown>
  const query = obj.pattern ?? obj.query ?? obj.search
  return typeof query === 'string' ? query : undefined
}

/**
 * Extract failed targets from steps for retry detection.
 * Returns a list of targets (file paths, commands, search queries) that failed.
 *
 * @param steps - Array of SDK execution steps
 * @returns Array of failed target identifiers
 */
export function extractFailedTargets(steps: ExecutionStep[]): string[] {
  const targets: string[] = []

  for (const step of steps) {
    const content = step.content ?? []
    for (const item of content) {
      if (!item.toolName || !isToolFailure(item)) continue

      const toolName = item.toolName.toLowerCase()

      const input = getToolInput(item)

      // File operations
      if (FILE_TOOLS.has(toolName)) {
        const path = extractFilePath(input)
        if (path) targets.push(path)
      }

      // Terminal operations
      if (TERMINAL_TOOLS.has(toolName)) {
        const command = extractCommand(input)
        if (command) targets.push(command)
      }

      // Search operations - extract identifiers from queries
      if (SEARCH_TOOLS.has(toolName)) {
        const query = extractSearchQuery(input)
        if (query) targets.push(query)
      }
    }
  }

  const deduplicated = [...new Set(targets)]

  logger.info('failure_extraction.targets', {
    rawCount: targets.length,
    deduplicatedCount: deduplicated.length,
    targets: deduplicated,
  })

  return deduplicated
}

/**
 * Check if text contains term at word boundaries (not partial matches).
 *
 * Uses string-based matching instead of dynamic RegExp to avoid Semgrep ReDoS
 * warnings (code scanning alert #1570). The approach is equivalent to \b word
 * boundary matching but uses indexOf + manual boundary checks.
 *
 * Loops through all occurrences to find valid word boundaries, not just the first.
 */
export function hasWordBoundaryMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase()
  const termLower = term.toLowerCase()

  let searchStart = 0
  while (searchStart < textLower.length) {
    const idx = textLower.indexOf(termLower, searchStart)
    if (idx === -1) return false

    // Check word boundary before: start of string or non-word char
    const before = idx === 0 || !/\w/.test(textLower[idx - 1]!)
    // Check word boundary after: end of string or non-word char
    const after =
      idx + termLower.length >= textLower.length || !/\w/.test(textLower[idx + termLower.length]!)

    if (before && after) return true

    // Move past this occurrence and try the next one
    searchStart = idx + 1
  }

  return false
}

/**
 * Check if a user message references a failed target.
 * Used for retry detection in Phase 6.
 *
 * Uses word boundary matching to avoid false positives from partial matches
 * (e.g., "button" should not match "unbutton").
 *
 * @param message - User message text
 * @param target - Failed target to check for (file path, command, or search query)
 * @returns True if the message likely references the target
 */
/**
 * Extract identifier-like tokens from a string.
 * Matches camelCase, PascalCase, snake_case, and kebab-case identifiers.
 * Used for search query matching to avoid false positives from common words.
 */
function extractIdentifiers(text: string): string[] {
  // Match identifiers: camelCase, PascalCase, snake_case, SCREAMING_SNAKE, kebab-case
  // Must be at least 4 chars to avoid matching common short words
  const identifierPattern = /[a-zA-Z][a-zA-Z0-9]*(?:[_-][a-zA-Z0-9]+)+|[a-z]+[A-Z][a-zA-Z0-9]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*/g
  const matches = text.match(identifierPattern) ?? []
  return matches.filter(m => m.length >= 4)
}

export function messageReferencesTarget(message: string, target: string): boolean {
  const messageLower = message.toLowerCase()

  // For file paths, check filename without common extensions
  if (target.includes('/')) {
    const filename = target.split('/').pop()?.toLowerCase()
    if (filename && filename.length > 2) {
      // Strip common extensions to avoid matching on ".tsx" etc
      const nameWithoutExt = filename.replace(/\.(tsx?|jsx?|css|json|md|html|scss|less)$/, '')
      if (nameWithoutExt.length > 2 && hasWordBoundaryMatch(messageLower, nameWithoutExt)) {
        return true
      }
      // Also try full filename for specific references like "fix index.ts"
      if (hasWordBoundaryMatch(messageLower, filename)) {
        return true
      }
    }
    return false
  }

  // Known CLI commands that might appear as first word of a target
  // Used to distinguish "npm install" (command) from "function handleSubmit" (search query)
  const knownCommands = new Set([
    'npm', 'npx', 'pnpm', 'yarn', 'node', 'git', 'curl', 'wget', 'make', 'cargo',
    'pip', 'python', 'ruby', 'go', 'docker', 'kubectl', 'terraform', 'aws', 'gcloud',
    'cd', 'ls', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'chown',
  ])

  const firstWord = target.split(' ')[0]?.toLowerCase()
  const isCommand = firstWord && knownCommands.has(firstWord)

  // For commands (with or without arguments), check command name with word boundary
  // This handles both "npm" and "npm install" - match on the command name
  if (isCommand && firstWord.length > 2 && hasWordBoundaryMatch(messageLower, firstWord)) {
    return true
  }

  // Check if target looks like a search query (contains spaces but no shell metacharacters)
  // Search queries need special handling to avoid false positives from generic words
  const isSearchQuery = target.includes(' ') && !/[|;&<>$]/.test(target) && !isCommand
  if (isSearchQuery) {
    // Extract specific identifiers from the query (camelCase, snake_case, etc.)
    const identifiers = extractIdentifiers(target)
    for (const id of identifiers) {
      if (hasWordBoundaryMatch(messageLower, id.toLowerCase())) {
        return true
      }
    }
    // If no identifiers found, don't match - avoids "function foo" matching on "function"
    return false
  }

  // For single-word targets that aren't known commands, check with word boundary
  if (!target.includes(' ') && firstWord && firstWord.length > 2) {
    return hasWordBoundaryMatch(messageLower, firstWord)
  }

  return false
}
