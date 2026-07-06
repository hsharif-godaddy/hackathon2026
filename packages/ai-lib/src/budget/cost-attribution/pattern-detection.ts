/**
 * Pattern Detection Module
 *
 * Detects behavioral patterns indicating agent inefficiency using severity-based scoring.
 * Each pattern has a continuous severity (0-1) computed from validated formulas.
 * Only patterns with severity > 0 are returned as fired patterns.
 *
 * Patterns detected:
 * - repeated_reads: Same file read repeatedly without intervening edits (threshold: 3)
 * - repeated_edits: Same file edited repeatedly without intervening reads (threshold: 5)
 * - grep_spiral: High-volume searching with empty results (threshold: 5)
 * - terminal_failures: Terminal commands failing with high ratio (threshold: 3)
 * - edit_read_loops: Edit→read→edit cycles on same file (threshold: 3)
 */

import stringify from 'safe-stable-stringify'
import {
  PATTERN_THRESHOLDS,
  PatternType,
  StepContentType,
  ZERO_PATTERN_COUNTS,
  isTerminalTool,
  isSearchTool,
  isWorkflowTool,
  classifyFileOp,
  getToolInput,
  getToolOutput,
  type ExecutionStep,
  type FileOpKind,
  type PatternCounts,
  type PatternDetectionResult,
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

export interface FileOp {
  callId: string
  toolType: FileOpKind
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

/** Longest consecutive run of targetType ops, reset by the opposite type. */
export interface RunResult {
  length: number
  callIds: string[]
}

export function longestSameTypeRun(
  ops: FileOp[],
  targetType: FileOpKind
): RunResult {
  const sorted: FileOp[] = [...ops].sort((a, b) => a.stepIdx - b.stepIdx)
  let maxLength = 0
  let maxCallIds: string[] = []
  let runCallIds: string[] = []

  for (const op of sorted) {
    if (op.toolType === targetType) {
      runCallIds.push(op.callId)
      if (runCallIds.length > maxLength) {
        maxLength = runCallIds.length
        maxCallIds = [...runCallIds]
      }
    } else {
      runCallIds = []
    }
  }

  return { length: maxLength, callIds: maxCallIds }
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
          argsSignature: stringify(input ?? {}) ?? String(input),
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
 * Repeated reads: severity_curve(max_read_run_same_file, 3)
 *
 * Counts the longest run of reads of one file uninterrupted by an edit of that
 * file, not the raw read count. A verify-after-edit read starts a new run, so
 * normal "edit, verify, edit, verify" iteration does not inflate the count;
 * only genuine consecutive re-reading (no intervening progress) trips it.
 */
function detectRepeatedReads(fileOps: FileOp[]): PatternResult | null {
  const opsByFile = groupBy(fileOps, op => op.filePath)
  let maxReads = 0
  let maxFile = ''
  let maxCallIds: string[] = []

  for (const [filePath, ops] of opsByFile) {
    if (filePath === 'unknown') continue
    const run = longestSameTypeRun(ops, 'read')
    if (run.length > maxReads) {
      maxReads = run.length
      maxFile = filePath
      maxCallIds = run.callIds
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
 * Repeated edits: severity_curve(max_edit_run_same_file, 5)
 *
 * Same temporal rule as repeated reads, inverted: counts the longest run of
 * edits uninterrupted by a read of that file, so verify-interleaved editing
 * does not read as a stuck loop.
 */
function detectRepeatedEdits(fileOps: FileOp[]): PatternResult | null {
  const opsByFile = groupBy(fileOps, op => op.filePath)
  let maxEdits = 0
  let maxFile = ''
  let maxCallIds: string[] = []

  for (const [filePath, ops] of opsByFile) {
    if (filePath === 'unknown') continue
    const run = longestSameTypeRun(ops, 'edit')
    if (run.length > maxEdits) {
      maxEdits = run.length
      maxFile = filePath
      maxCallIds = run.callIds
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

// COUNT EXTRACTION

function computePatternCounts(
  fileOps: FileOp[],
  grepOps: GrepOp[],
  terminalOps: TerminalOp[],
  allToolCalls: ToolCallOp[]
): PatternCounts {
  const counts: PatternCounts = { ...ZERO_PATTERN_COUNTS }

  const readsByFile: Map<string, FileOp[]> = groupBy(fileOps.filter(op => op.toolType === 'read'), op => op.filePath)
  for (const [filePath, ops] of readsByFile) {
    if (filePath === 'unknown') continue
    if (ops.length > counts.repeated_reads) counts.repeated_reads = ops.length
  }

  const editsByFile: Map<string, FileOp[]> = groupBy(fileOps.filter(op => op.toolType === 'edit'), op => op.filePath)
  for (const [filePath, ops] of editsByFile) {
    if (filePath === 'unknown') continue
    if (ops.length > counts.repeated_edits) counts.repeated_edits = ops.length
  }

  counts.grep_spiral = grepOps.length

  counts.terminal_failures = terminalOps.filter(op => op.failed).length

  const opsByFile: Map<string, FileOp[]> = groupBy(fileOps, op => op.filePath)
  for (const [filePath, ops] of opsByFile) {
    if (filePath === 'unknown') continue
    const sorted: FileOp[] = [...ops].sort((a, b) => a.stepIdx - b.stepIdx)
    let transitions: number = 0
    for (let i: number = 1; i < sorted.length; i++) {
      const curr: FileOp | undefined = sorted[i]
      const prev: FileOp | undefined = sorted[i - 1]
      if (curr && prev && curr.toolType !== prev.toolType) transitions++
    }
    const loopCount: number = Math.floor(transitions / 2)
    if (loopCount > counts.edit_read_loop) counts.edit_read_loop = loopCount
  }

  const filteredCalls: ToolCallOp[] = allToolCalls.filter(op => !isWorkflowTool(op.toolName))
  const bySignature: Map<string, ToolCallOp[]> = groupBy(filteredCalls, op => `${op.toolName}::${op.argsSignature}`)
  for (const [, ops] of bySignature) {
    const uniqueSteps: number = new Set(ops.map(op => op.stepIdx)).size
    if (uniqueSteps > counts.tool_retry) counts.tool_retry = uniqueSteps
  }

  return counts
}

// MAIN DETECTION

/**
 * Detect behavioral patterns with severity scoring.
 * Returns fired patterns (severity > 0) and raw counts for all patterns
 * regardless of whether they fired (for threshold optimality dashboarding).
 */
export function detectHighConfidencePatterns(steps: ExecutionStep[]): PatternDetectionResult {
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

  const counts: PatternCounts = computePatternCounts(fileOps, grepOps, terminalOps, allToolCalls)

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

  return { patterns, counts }
}

