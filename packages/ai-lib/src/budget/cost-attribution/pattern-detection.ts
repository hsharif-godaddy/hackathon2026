/**
 * Pattern Detection Module
 *
 * Detects behavioral patterns indicating agent inefficiency using severity-based scoring.
 * Each pattern has a continuous severity (0-1) computed from validated formulas.
 * Only patterns with severity > 0 are returned as fired patterns.
 *
 * Patterns detected:
 * - repeated_reads: Same file read excessively (threshold: 3)
 * - repeated_edits: Same file edited excessively (threshold: 5)
 * - grep_spiral: High-volume searching with empty results (threshold: 5)
 * - terminal_failures: Terminal commands failing with high ratio (threshold: 3)
 * - edit_read_loops: Edit→read→edit cycles on same file (threshold: 3)
 */

import {
  PATTERN_THRESHOLDS,
  PatternType,
  StepContentType,
  isTerminalTool,
  isSearchTool,
  isWorkflowTool,
  classifyFileOp,
  getToolInput,
  getToolOutput,
  type ExecutionStep,
  type PatternResult,
} from './types.js'
import { getCorrelationId, isSoftToolFailure } from './failure-extraction.js'
import { createLogger } from '@airo/ai-common'

const logger = createLogger('pattern-detection')

// SEVERITY CURVE

const LOG_5 = Math.log(5)

/**
 * Logarithmic severity curve.
 * Returns 0 at threshold, scales to 1 at 5× threshold.
 *
 * severity_curve(value, threshold) = clamp(log(value/threshold) / log(5), 0, 1)
 */
export function severityCurve(value: number, threshold: number): number {
  if (value <= threshold || threshold <= 0) return 0
  return Math.min(1, Math.log(value / threshold) / LOG_5)
}

// HELPER TYPES

interface TerminalOp {
  callId: string
  failed: boolean
  stepIdx: number
}

interface FileOp {
  callId: string
  toolType: 'edit' | 'read'
  filePath: string
  stepIdx: number
}

interface GrepOp {
  callId: string
  hasResults: boolean
  stepIdx: number
}

// EXTRACTION HELPERS

function extractFilePath(args: unknown): string {
  if (!args || typeof args !== 'object') return 'unknown'
  const obj = args as Record<string, unknown>
  return String(obj.path ?? obj.file_path ?? obj.filePath ?? 'unknown')
}

function isEmptyResult(output: unknown): boolean {
  if (!output) return true
  if (typeof output === 'string') {
    const lower = output.toLowerCase()
    return output.trim() === '' || lower.includes('no matches') || lower.includes('no results')
  }
  if (Array.isArray(output)) return output.length === 0
  return false
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const key = keyFn(item)
    const existing = map.get(key)
    if (existing) {
      existing.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

// OPERATION COLLECTION

interface ToolCallOp {
  callId: string
  toolName: string
  argsSignature: string
  stepIdx: number
}

interface CollectedOperations {
  terminalOps: TerminalOp[]
  fileOps: FileOp[]
  grepOps: GrepOp[]
  allToolCalls: ToolCallOp[]
}

/**
 * Create a stable JSON string representation of an object for deduplication.
 * Uses recursive key sorting to ensure consistent output regardless of key order,
 * while preserving arrays intact (the replacer-array form of JSON.stringify
 * drops array contents since array indices aren't string keys).
 */
function stableStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as object).sort())
        : v
    )
  } catch {
    return String(obj)
  }
}

function collectOperations(steps: ExecutionStep[]): CollectedOperations {
  const terminalOps: TerminalOp[] = []
  const fileOps: FileOp[] = []
  const grepOps: GrepOp[] = []
  const allToolCalls: ToolCallOp[] = []

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx]
    if (!step) continue
    const callId = getCorrelationId(step)
    if (!callId) continue

    const content = step.content ?? []
    for (const item of content) {
      const toolName = item.toolName
      if (!toolName) continue

      const input = getToolInput(item)
      const output = getToolOutput(item)

      // Track all tool calls for generic retry detection
      // Count tool-result and tool-error items (completed or failed operations)
      if (item.type === StepContentType.ToolResult || item.type === StepContentType.ToolError) {
        allToolCalls.push({
          callId,
          toolName: toolName.toLowerCase(),
          argsSignature: stableStringify(input ?? {}),
          stepIdx,
        })
      }

      // Terminal operations — count on tool-result/tool-error to avoid double-counting
      if (isTerminalTool(toolName) && (item.type === StepContentType.ToolResult || item.type === StepContentType.ToolError)) {
        terminalOps.push({
          callId,
          failed: item.type === StepContentType.ToolError || isSoftToolFailure(item),
          stepIdx,
        })
      }

      // File operations — classify as edit or read.
      // Count on tool-result to represent completed operations.
      // classifyFileOp is command-aware: the editor's `view` is a read,
      // `str_replace`/`insert` are edits, and `create` (full-file write) is
      // excluded — edit churn detection only fires for targeted modifications.
      if (item.type === StepContentType.ToolResult) {
        const fileOpKind = classifyFileOp(toolName, input)
        if (fileOpKind) {
          const filePath = extractFilePath(input)
          fileOps.push({ callId, toolType: fileOpKind, filePath, stepIdx })
        }
      }

      // Grep operations
      if (isSearchTool(toolName) && item.type === StepContentType.ToolResult) {
        const hasResults = !isEmptyResult(output)
        grepOps.push({ callId, hasResults, stepIdx })
      }
    }
  }

  return { terminalOps, fileOps, grepOps, allToolCalls }
}

// INDIVIDUAL PATTERN DETECTION

/**
 * Repeated reads: severity_curve(max_reads_same_file, 3)
 */
function detectRepeatedReads(fileOps: FileOp[]): PatternResult | null {
  const reads = fileOps.filter(op => op.toolType === 'read')
  if (reads.length === 0) return null

  const readsByFile = groupBy(reads, op => op.filePath)
  let maxReads = 0
  let maxFile = ''
  let maxCallIds: string[] = []

  for (const [filePath, ops] of readsByFile) {
    if (filePath === 'unknown') continue
    if (ops.length > maxReads) {
      maxReads = ops.length
      maxFile = filePath
      maxCallIds = ops.map(op => op.callId)
    }
  }

  if (maxReads < PATTERN_THRESHOLDS.REPEATED_READS_MIN) return null

  const severity = severityCurve(maxReads, PATTERN_THRESHOLDS.REPEATED_READS_MIN)
  if (severity <= 0) return null

  return {
    type: PatternType.RepeatedReads,
    severity,
    callIds: unique(maxCallIds),
    details: `File "${maxFile}" read ${maxReads} times (severity: ${severity.toFixed(2)})`,
  }
}

/**
 * Repeated edits: severity_curve(max_edits_same_file, 5)
 */
function detectRepeatedEdits(fileOps: FileOp[]): PatternResult | null {
  const edits = fileOps.filter(op => op.toolType === 'edit')
  if (edits.length === 0) return null

  const editsByFile = groupBy(edits, op => op.filePath)
  let maxEdits = 0
  let maxFile = ''
  let maxCallIds: string[] = []

  for (const [filePath, ops] of editsByFile) {
    if (filePath === 'unknown') continue
    if (ops.length > maxEdits) {
      maxEdits = ops.length
      maxFile = filePath
      maxCallIds = ops.map(op => op.callId)
    }
  }

  if (maxEdits < PATTERN_THRESHOLDS.REPEATED_EDITS_MIN) return null

  const severity = severityCurve(maxEdits, PATTERN_THRESHOLDS.REPEATED_EDITS_MIN)
  if (severity <= 0) return null

  return {
    type: PatternType.RepeatedEdits,
    severity,
    callIds: unique(maxCallIds),
    details: `File "${maxFile}" edited ${maxEdits} times (severity: ${severity.toFixed(2)})`,
  }
}

/**
 * Grep spiral: min((grep_count / 5) * empty_result_ratio, 1.0)
 * Linear scaling, pure empty_result_ratio — zero severity when all greps succeed.
 */
function detectGrepSpiral(grepOps: GrepOp[]): PatternResult | null {
  const totalGreps = grepOps.length
  if (totalGreps < PATTERN_THRESHOLDS.GREP_SPIRAL_MIN) return null

  const emptyCount = grepOps.filter(op => !op.hasResults).length
  const emptyResultRatio = totalGreps > 0 ? emptyCount / totalGreps : 0

  const severity = Math.min((totalGreps / PATTERN_THRESHOLDS.GREP_SPIRAL_MIN) * emptyResultRatio, 1.0)
  if (severity <= 0) return null

  return {
    type: PatternType.GrepSpiral,
    severity,
    callIds: unique(grepOps.map(op => op.callId)),
    details: `${totalGreps} searches, ${emptyCount} empty (ratio: ${emptyResultRatio.toFixed(2)}, severity: ${severity.toFixed(2)})`,
  }
}

/**
 * Terminal failures: severity_curve(fail_count, 3) * fail_ratio
 * Pure ratio — forgiving to productive agents, only fires hard on tight failure loops.
 */
function detectTerminalFailures(terminalOps: TerminalOp[]): PatternResult | null {
  const totalTerminal = terminalOps.length
  if (totalTerminal === 0) return null

  const failedOps = terminalOps.filter(op => op.failed)
  const failCount = failedOps.length
  if (failCount < PATTERN_THRESHOLDS.TERMINAL_FAILURES_MIN) return null

  const failRatio = failCount / totalTerminal
  const severity = severityCurve(failCount, PATTERN_THRESHOLDS.TERMINAL_FAILURES_MIN) * failRatio
  if (severity <= 0) return null

  return {
    type: PatternType.TerminalFailures,
    severity,
    callIds: unique(failedOps.map(op => op.callId)),
    details: `${failCount}/${totalTerminal} terminal commands failed (ratio: ${failRatio.toFixed(2)}, severity: ${severity.toFixed(2)})`,
  }
}

/**
 * Edit-read loops: floor(transitions/2) per file, max across files.
 * severity_curve(max_loop_count, 3)
 *
 * A "transition" is when the operation type changes between consecutive operations
 * on the same file (edit→read or read→edit).
 */
function detectEditReadLoops(fileOps: FileOp[]): PatternResult | null {
  const opsByFile = groupBy(fileOps, op => op.filePath)

  let maxLoopCount = 0
  let maxFile = ''
  let maxCallIds: string[] = []

  for (const [filePath, ops] of opsByFile) {
    if (filePath === 'unknown') continue

    const sorted = [...ops].sort((a, b) => a.stepIdx - b.stepIdx)
    let transitions = 0

    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i]
      const prev = sorted[i - 1]
      if (curr && prev && curr.toolType !== prev.toolType) {
        transitions++
      }
    }

    const loopCount = Math.floor(transitions / 2)
    if (loopCount > maxLoopCount) {
      maxLoopCount = loopCount
      maxFile = filePath
      maxCallIds = sorted.map(op => op.callId)
    }
  }

  if (maxLoopCount < PATTERN_THRESHOLDS.EDIT_READ_LOOP_MIN_CYCLES) return null

  const severity = severityCurve(maxLoopCount, PATTERN_THRESHOLDS.EDIT_READ_LOOP_MIN_CYCLES)
  if (severity <= 0) return null

  return {
    type: PatternType.EditReadLoop,
    severity,
    callIds: unique(maxCallIds),
    details: `${maxLoopCount} edit-read cycles on "${maxFile}" (severity: ${severity.toFixed(2)})`,
  }
}

/**
 * Tool retry: same tool + same args called N+ times across different steps.
 * Catches retry loops on any tool type (not just terminal/grep/edit).
 * Excludes workflow tools (todoList, suggestedResponse) where repetition is expected.
 * severity_curve(max_duplicates, 3)
 */
function detectToolRetry(allToolCalls: ToolCallOp[]): PatternResult | null {
  // Filter out workflow tools where repeated calls are expected behavior
  const filteredCalls = allToolCalls.filter(op => !isWorkflowTool(op.toolName))

  // Group by tool name + args signature
  const bySignature = groupBy(filteredCalls, op => `${op.toolName}::${op.argsSignature}`)

  let maxCount = 0
  let maxToolName = ''
  let maxCallIds: string[] = []

  for (const [signature, ops] of bySignature) {
    // Only count calls across different steps (same step = single LLM call)
    const uniqueSteps = new Set(ops.map(op => op.stepIdx))
    if (uniqueSteps.size > maxCount) {
      maxCount = uniqueSteps.size
      maxToolName = ops[0]?.toolName ?? signature.split('::')[0] ?? 'unknown'
      maxCallIds = ops.map(op => op.callId)
    }
  }

  if (maxCount < PATTERN_THRESHOLDS.TOOL_RETRY_MIN) return null

  const severity = severityCurve(maxCount, PATTERN_THRESHOLDS.TOOL_RETRY_MIN)
  if (severity <= 0) return null

  logger.debug('pattern_detection.tool_retry_detected', {
    toolName: maxToolName,
    duplicateCount: maxCount,
    severity,
  })

  return {
    type: PatternType.ToolRetry,
    severity,
    callIds: unique(maxCallIds),
    details: `"${maxToolName}" called ${maxCount} times with identical args (severity: ${severity.toFixed(2)})`,
  }
}

// MAIN DETECTION

/**
 * Detect behavioral patterns with severity scoring.
 * Returns only patterns with severity > 0 (fired patterns for attribution).
 *
 * @param steps - Array of SDK execution steps
 * @returns Array of detected patterns with severity scores
 */
export function detectHighConfidencePatterns(steps: ExecutionStep[]): PatternResult[] {
  const { terminalOps, fileOps, grepOps, allToolCalls } = collectOperations(steps)

  const reads = fileOps.filter(op => op.toolType === 'read')
  const edits = fileOps.filter(op => op.toolType === 'edit')

  logger.debug('pattern_detection.operations_collected', {
    totalSteps: steps.length,
    terminalOps: terminalOps.length,
    terminalFailed: terminalOps.filter(op => op.failed).length,
    fileReads: reads.length,
    fileEdits: edits.length,
    grepOps: grepOps.length,
    grepEmpty: grepOps.filter(op => !op.hasResults).length,
    uniqueReadFiles: new Set(reads.map(op => op.filePath)).size,
    uniqueEditFiles: new Set(edits.map(op => op.filePath)).size,
  })

  const patterns: PatternResult[] = []

  const repeatedReads = detectRepeatedReads(fileOps)
  if (repeatedReads) patterns.push(repeatedReads)

  const repeatedEdits = detectRepeatedEdits(fileOps)
  if (repeatedEdits) patterns.push(repeatedEdits)

  const grepSpiral = detectGrepSpiral(grepOps)
  if (grepSpiral) patterns.push(grepSpiral)

  const terminalFailures = detectTerminalFailures(terminalOps)
  if (terminalFailures) patterns.push(terminalFailures)

  const editReadLoops = detectEditReadLoops(fileOps)
  if (editReadLoops) patterns.push(editReadLoops)

  const toolRetry = detectToolRetry(allToolCalls)
  if (toolRetry) patterns.push(toolRetry)

  if (patterns.length > 0) {
    logger.debug('pattern_detection.patterns_fired', {
      count: patterns.length,
      patterns: patterns.map(p => ({
        type: p.type,
        severity: p.severity,
        callIds: p.callIds.length,
      })),
    })
  } else {
    logger.debug('pattern_detection.no_patterns_fired')
  }

  return patterns
}

