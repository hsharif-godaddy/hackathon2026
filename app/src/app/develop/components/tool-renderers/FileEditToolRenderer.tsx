'use client'

import { useState, useEffect, useRef } from 'react'
import KeyValueTable from './KeyValueTable'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { completePartialJson } from './json-completion-utils'
import EditIcon from '@ux/icon/edit'
import text from '@ux/text'
import Tag from '@ux/tag'

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Get mode-specific action verb
 */
function getModeVerb(mode: string): string {
  const verbMap: Record<string, string> = {
    'create': 'Created',
    'edit': 'Edit',
    'rewrite': 'Rewrite',
    'delete': 'Delete'
  }
  return verbMap[mode] || mode
}

/**
 * Count line changes for a single operation payload
 *
 * Supports both legacy flat structure and new batch operations entries.
 *
 * @param operation - Operation object containing edits or content
 * @returns Object with additions and deletions counts
 */
function countLinesForOperation(operation: any): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0

  if (operation && Array.isArray(operation.edits)) {
    for (const edit of operation.edits) {
      if (edit?.old && typeof edit.old === 'string') {
        deletions += (edit.old.match(/\n/g) || []).length
      }
      if (edit?.new && typeof edit.new === 'string') {
        additions += (edit.new.match(/\n/g) || []).length
      }
    }
  } else if (operation?.content && typeof operation.content === 'string') {
    additions = (operation.content.match(/\n/g) || []).length
  }

  return { additions, deletions }
}

/**
 * Count line changes from parsed JSON object
 *
 * Supports both legacy single-operation payloads and the new batch format
 * where operations are nested in `operations`.
 *
 * @param parsed - Parsed JSON object with edits/content fields or operations array
 * @returns Object with additions and deletions counts
 */
function countLinesFromParsed(parsed: any): { additions: number; deletions: number } {
  if (parsed && Array.isArray(parsed.operations)) {
    return parsed.operations.reduce(
      (totals: { additions: number; deletions: number }, op: any) => {
        const { additions, deletions } = countLinesForOperation(op)
        return {
          additions: totals.additions + additions,
          deletions: totals.deletions + deletions
        }
      },
      { additions: 0, deletions: 0 }
    )
  }

  return countLinesForOperation(parsed)
}

/**
 * Estimate line counts from partial input streaming
 *
 * Attempts to complete partial JSON by adding closing characters, then parses normally.
 * This allows us to extract values from incomplete JSON strings as they stream in.
 */
export function estimateLineCountsFromPartial(partialInput: string): { additions: number; deletions: number } | null {
  if (!partialInput || partialInput.length < 20) {
    return null
  }

  // First, try to parse as complete JSON (fastest path)
  try {
    const parsed = JSON.parse(partialInput)
    return countLinesFromParsed(parsed)
  } catch {
    // JSON is incomplete, try to complete it
  }

  // Try to complete the partial JSON
  const completedJsonResult = completePartialJson(partialInput)
  if (!completedJsonResult) {
    return null
  }
  const completedJson = completedJsonResult

  // Try to parse the completed JSON
  try {
    const parsed = JSON.parse(completedJson)
    return countLinesFromParsed(parsed)
  } catch {
    // Parsing failed, return null to use last successful estimate
    return null
  }
}

/**
 * Operation modes recognized while parsing streaming input.
 */
type StreamingOperationMode = 'edit' | 'create' | 'rewrite' | 'delete'

/**
 * Result of parsing streaming file edit input
 */
interface ParsedStreamingInput {
  /** Whether this is a batch operation with multiple files */
  isBatch: boolean
  /** Number of files in the batch operation (0 if not a batch) */
  batchCount: number
  /** First operation details, or null if parsing failed */
  firstOp: {
    /** File path being operated on */
    path?: string
    /** Operation mode */
    mode?: StreamingOperationMode
    /** Edit operations (for edit mode) */
    edits?: Array<{ old: string; new: string }>
    /** File content (for create/rewrite modes) */
    content?: string
  } | null
}

const STREAMING_OPERATION_MODES: ReadonlyArray<StreamingOperationMode> = ['edit', 'create', 'rewrite', 'delete'] as const

/**
 * Determine whether a value is a supported streaming mode.
 *
 * @param value - Unknown value to validate
 * @returns True if value is a supported streaming operation mode
 */
function isStreamingOperationMode(value: unknown): value is StreamingOperationMode {
  return typeof value === 'string' && STREAMING_OPERATION_MODES.includes(value as StreamingOperationMode)
}

/**
 * Normalize an operation-like object into `firstOp` shape.
 *
 * @param operation - Candidate operation payload
 * @returns Normalized operation details or null when insufficient data
 */
function extractOperationDetails(operation: any): ParsedStreamingInput['firstOp'] | null {
  if (!operation || typeof operation !== 'object') {
    return null
  }

  const path = typeof operation.path === 'string' ? operation.path : undefined
  const mode = isStreamingOperationMode(operation.mode) ? operation.mode : undefined
  const content = typeof operation.content === 'string' ? operation.content : undefined
  const edits = Array.isArray(operation.edits)
    ? operation.edits.filter(
        (edit: any): edit is { old: string; new: string } =>
          Boolean(edit) && typeof edit.old === 'string' && typeof edit.new === 'string'
      )
    : undefined

  if (!path && !mode && (!edits || edits.length === 0) && !content) {
    return null
  }

  return {
    ...(path && { path }),
    ...(mode && { mode }),
    ...(edits && edits.length > 0 && { edits }),
    ...(content && { content })
  }
}

/**
 * Attempt to parse complete JSON for streaming data.
 *
 * @param jsonString - Candidate JSON string (complete)
 * @returns Parsed streaming input or null when parsing fails
 */
function tryParseStreamingJson(jsonString: string | null): ParsedStreamingInput | null {
  if (!jsonString) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonString)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    if (Array.isArray(parsed.operations)) {
      const normalizedOperations = parsed.operations
        .map(extractOperationDetails)
        .filter((op): op is NonNullable<ParsedStreamingInput['firstOp']> => Boolean(op))
      const batchCount = normalizedOperations.filter(op => Boolean(op.path)).length
      const firstOp = normalizedOperations[0] ?? null
      return { isBatch: true, batchCount, firstOp }
    }

    const singleOperation = extractOperationDetails(parsed)
    if (singleOperation) {
      return { isBatch: false, batchCount: 0, firstOp: singleOperation }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Parse streaming partial input to extract batch and operation info
 *
 * Consolidates all parsing logic to avoid duplication and ensure consistency.
 * Attempts to parse complete JSON first, then tries completing partial JSON,
 * and finally falls back to string matching for batch detection.
 *
 * @param partialInput - Partial JSON string from streaming tool input
 * @returns Parsed operation information with type safety
 */
export function parseStreamingInput(partialInput: string): ParsedStreamingInput {
  // Try to parse the partial input directly
  const parsedResult = tryParseStreamingJson(partialInput)
  if (parsedResult) {
    return parsedResult
  }

  // Attempt to complete the JSON when streaming is still in-flight
  const completedJson = completePartialJson(partialInput)
  const completedResult = tryParseStreamingJson(completedJson || null)
  if (completedResult) {
    return completedResult
  }

  // Fallback: detect batch by string matching when JSON parsing is not yet possible
  if (partialInput.includes('"operations"')) {
    const pathMatches = partialInput.match(/"path"\s*:\s*"/g)
    if (pathMatches && pathMatches.length > 0) {
      return { isBatch: true, batchCount: pathMatches.length, firstOp: null }
    }
  }

  return { isBatch: false, batchCount: 0, firstOp: null }
}

/**
 * Determine if batch operations should be displayed as a batch or single operation
 *
 * Single-file batches are displayed as single operations for better UX,
 * while multi-file batches are displayed with batch summary UI.
 *
 * @param isBatch - Whether the operation format is batch (new streaming payloads default to true)
 * @param batchCount - Number of files in the batch operation
 * @param firstOp - First operation details (null if parsing incomplete)
 * @returns True if should display as batch, false if should display as single operation
 */
function shouldDisplayAsBatch(
  isBatch: boolean,
  batchCount: number,
  firstOp: ParsedStreamingInput['firstOp']
): boolean {
  // Single-file batch: display as single operation for cleaner UX
  if (isBatch && batchCount === 1 && firstOp) {
    return false
  }

  // Multi-file batch: display as batch with summary
  if (isBatch && batchCount > 1) {
    return true
  }

  // Default to single operation display
  return false
}

/**
 * Custom renderer for fileEdit tool
 *
 * Shows mode-aware message: "Created {filename}", "Edit {filename} (+5 -3)", etc.
 * Shows streaming line counts as deltas arrive.
 * Clickable to show modal with full diff and metadata.
 */
export default function FileEditToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result,
  partialInput
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const lastSuccessfulEstimateRef = useRef<{ additions: number; deletions: number } | null>(null)
  const [streamingEstimate, setStreamingEstimate] = useState<{ additions: number; deletions: number } | null>(null)

  // Track client-side mount to prevent SSR issues with ToolModal portal
  useEffect(() => {
    setMounted(true)
  }, [])

  /**
   * Manage streaming estimate lifecycle
   *
   * Handles two scenarios:
   * 1. Tool completed/stopped: Resets estimate ref and state to prevent stale data
   * 2. Tool running: Parses partial input to extract real-time line count estimates
   *
   * Consolidates reset and update logic in a single effect to avoid race conditions
   * and simplify state management. Falls back to last successful estimate if parsing fails.
   *
   * @remarks Runs on every toolStatus or partialInput change for real-time updates
   */
  useEffect(() => {
    if (toolStatus !== 'running') {
      // Tool completed or stopped - reset everything
      lastSuccessfulEstimateRef.current = null
      setStreamingEstimate(null)
    } else if (partialInput) {
      // Tool running with input - update streaming estimate
      const estimate = estimateLineCountsFromPartial(partialInput)
      if (estimate) {
        lastSuccessfulEstimateRef.current = estimate
        setStreamingEstimate(estimate)
      } else if (lastSuccessfulEstimateRef.current) {
        // Use last successful if current parsing failed
        setStreamingEstimate(lastSuccessfulEstimateRef.current)
      }
    }
  }, [toolStatus, partialInput])

  // Parse result - can be JSON (new format) or Markdown (old format)
  let parsedResult: any = null
  let filePath = ''
  let filename = ''
  let mode = 'edit'
  let changes: { additions: number; deletions: number; totalLines: number } | null = null
  let diff = ''
  let error = ''
  let warning = ''
  let isMarkdownFormat = false
  let markdownContent = ''
  let normalizedToBatch = false
  let batchOperations: any[] = []
  let totalOperations = 0
  let completedOperations = 0
  let commitHash = ''

  // For streaming: parse partial input to extract operation details
  let streamingChanges: { additions: number; deletions: number } | null = null
  let streamingPath: string | null = null
  let streamingMode: string | null = null
  let displayAsBatch = false
  let streamingBatchCount = 0

  if (toolStatus === 'running' && partialInput) {
    const { isBatch, batchCount, firstOp } = parseStreamingInput(partialInput)
    streamingBatchCount = batchCount
    displayAsBatch = shouldDisplayAsBatch(isBatch, batchCount, firstOp)

    // Extract streaming data from first operation if available
    if (firstOp) {
      streamingChanges = streamingEstimate
      streamingPath = firstOp.path || null
      streamingMode = firstOp.mode || null
    }
  }

  if (result) {
    try {
      // Result might be a string (JSON or Markdown) or already an object
      if (typeof result === 'string') {
        // Try to parse as JSON first
        try {
          parsedResult = JSON.parse(result)
        } catch {
          // If JSON parse fails, it's the old markdown format
          isMarkdownFormat = true
          markdownContent = result
        }
      } else if (typeof result === 'object') {
        parsedResult = result
      }

      if (parsedResult) {
        // Check if this is a batch result (has operations array)
        if (parsedResult.operations && Array.isArray(parsedResult.operations)) {
          normalizedToBatch = true
          batchOperations = parsedResult.operations
          totalOperations = parsedResult.totalOperations ?? batchOperations.length
          completedOperations = parsedResult.completedOperations || 0
          commitHash = parsedResult.commitHash || ''
          error = parsedResult.error || ''

          // For display, use first operation's details
          if (batchOperations.length > 0) {
            const firstOp = batchOperations[0]
            filePath = firstOp.path || ''
            filename = getFilename(filePath)
            mode = firstOp.mode || 'edit'
          }
        } else if (parsedResult.path) {
          // LEGACY single-operation format from old conversation history
          // Wrap in batch structure for uniform display logic
          normalizedToBatch = true
          batchOperations = [{
            path: parsedResult.path,
            mode: parsedResult.mode || 'edit',
            success: parsedResult.success ?? true,
            changes: parsedResult.changes,
            diff: parsedResult.diff,
            error: parsedResult.error,
            warning: parsedResult.warning,
          }]
          totalOperations = 1
          completedOperations = parsedResult.success ? 1 : 0
          filePath = parsedResult.path || ''
          filename = getFilename(filePath)
          mode = parsedResult.mode || 'edit'
          changes = parsedResult.changes || null
          diff = parsedResult.diff || ''
          error = parsedResult.error || ''
          warning = parsedResult.warning || ''
        }
      }
    } catch (e) {
      console.error('Failed to parse fileEdit result:', e)
    }
  }

  // Also check input for path if result parsing failed
  if (!filePath && input && typeof input === 'object') {
    const inputObj = input as any
    filePath = inputObj.path || ''
    filename = getFilename(filePath)
    mode = inputObj.mode || 'edit'
  }

  // Use streaming path/mode if available and no final values yet
  if (!filePath && streamingPath) {
    filePath = streamingPath
    filename = getFilename(filePath)
  }
  if (!mode && streamingMode) {
    mode = streamingMode
  }

  const verb = getModeVerb(mode)

  // Build compact display message
  let displayMessage = ''

  if (normalizedToBatch) {
    // Batch operation: show summary
    if (error) {
      // Partial failure: show completed/total
      displayMessage = `Files: ${completedOperations}/${totalOperations} completed`
    } else {
      // Full success: show operation counts by type
      const created = batchOperations.filter(op => op.success && op.mode === 'create').length
      const edited = batchOperations.filter(op => op.success && op.mode === 'edit').length
      const rewritten = batchOperations.filter(op => op.success && op.mode === 'rewrite').length
      const deleted = batchOperations.filter(op => op.success && op.mode === 'delete').length

      const parts: string[] = []
      if (created > 0) parts.push(`${created} created`)
      if (edited > 0) parts.push(`${edited} edited`)
      if (rewritten > 0) parts.push(`${rewritten} rewritten`)
      if (deleted > 0) parts.push(`${deleted} deleted`)

      displayMessage = `Files: ${parts.join(', ')}`
    }
  } else if (displayAsBatch) {
    // Streaming batch operation: show individual operations with details
    try {
      // Try to parse all operations from streaming input
      const parsed = partialInput ? JSON.parse(completePartialJson(partialInput) || partialInput) : null
      if (parsed?.operations && Array.isArray(parsed.operations) && parsed.operations.length > 0) {
        const MAX_DISPLAY_OPS = 3
        const operations = parsed.operations.slice(0, MAX_DISPLAY_OPS)
        const opSummaries = operations.map((op: any) => {
          const filename = getFilename(op.path || '')
          const opMode = op.mode || 'edit'
          const opVerb = getModeVerb(opMode)
          return `${opVerb}: ${filename}`
        })

        if (parsed.operations.length > MAX_DISPLAY_OPS) {
          opSummaries.push(`+${parsed.operations.length - MAX_DISPLAY_OPS} more`)
        }

        displayMessage = opSummaries.join(', ')
      } else {
        // Fallback to count if parsing fails
        displayMessage = `Files: processing ${streamingBatchCount} file${streamingBatchCount !== 1 ? 's' : ''}...`
      }
    } catch {
      // Fallback to count if any error occurs
      displayMessage = `Files: processing ${streamingBatchCount} file${streamingBatchCount !== 1 ? 's' : ''}...`
    }
  } else {
    // Single operation: format: "Edit: filename +5 -5"
    displayMessage = `${verb}: ${filename}`

    // Use streaming changes if available (tool is running), otherwise use final changes
    const displayChanges = streamingChanges || changes
    if (displayChanges) {
      if (mode === 'create') {
        // For create mode, show only additions (new file)
        displayMessage += ` +${displayChanges.additions}`
      } else {
        // For edit/rewrite modes, show additions and deletions
        displayMessage += ` +${displayChanges.additions} -${displayChanges.deletions}`
      }
    }
  }

  // Has details if we have parsed result data (diff, metadata, etc.) OR markdown content OR batch operations
  const hasDetails = Boolean(
    (parsedResult && (diff || changes || error || warning || filePath || normalizedToBatch)) ||
    isMarkdownFormat
  )

  // Build metadata for modal
  const metadata: Record<string, any> = {}

  if (normalizedToBatch) {
    // Multi-file operation metadata
    metadata['Total Files'] = totalOperations
    metadata['Completed Files'] = completedOperations
    if (commitHash) {
      metadata['Commit Hash'] = commitHash
    }
  } else {
    // Single operation metadata
    if (filePath) {
      metadata['Full Path'] = filePath
    }
    if (mode) {
      metadata['Mode'] = mode
    }
    if (changes) {
      metadata['Lines Added'] = changes.additions
      metadata['Lines Deleted'] = changes.deletions
      metadata['Total Lines'] = changes.totalLines
    }
  }

  const modalTitle = normalizedToBatch ? 'File Operations' : `${verb} ${filename}`

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={modalTitle}
      mounted={mounted}
    >
      {/* Markdown format (backwards compatibility) */}
      {isMarkdownFormat && (
        <div className="flex-1 overflow-y-auto">
          <MarkdownRenderer content={markdownContent} fullscreen={true} />
        </div>
      )}

      {/* JSON format (new) */}
      {!isMarkdownFormat && (
        <div className="flex-1 overflow-y-auto">
          {/* Metadata */}
          {Object.keys(metadata).length > 0 && (
            <div className="mb-2">
              <KeyValueTable data={metadata} />
            </div>
          )}

          {/* Batch operations list */}
          {normalizedToBatch && batchOperations.length > 0 && (
            <div className="mb-2">
              <text.p className="mb-1" size={0}>
                Operations
              </text.p>
              <div className="space-y-1">
                {batchOperations.map((op, index) => (
                  <div
                    key={index}
                    className={`p-1.5 border rounded-md ${
                      op.success
                        ? 'border-border bg-muted/50'
                        : 'border-intents-ux-feedbackCritical-feedbackColor/30 bg-intents-ux-feedbackCritical-feedbackColor/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <Tag
                            emphasis={op.success ? 'success' : 'critical'}
                            size="sm"
                            className="flex-shrink-0"
                          >
                            {op.success ? 'Success' : 'Failed'}
                          </Tag>
                          <text.span className="truncate" size={0}>{op.path}</text.span>
                        </div>
                        <div className="mt-0.5">
                          <text.span size={-1} emphasis="passive">
                            Mode: {op.mode}
                            {op.changes && (
                              <span className="ml-1">
                                +{op.changes.additions} -{op.changes.deletions}
                              </span>
                            )}
                          </text.span>
                        </div>
                        {op.error && (
                          <div className="mt-1">
                            <Tag emphasis="critical" size="sm" className="mb-0.5">
                              Error
                            </Tag>
                            <text.span size={-1}>{op.error}</text.span>
                          </div>
                        )}
                        {op.warning && (
                          <div className="mt-1">
                            <Tag emphasis="warning" size="sm" className="mb-0.5">
                              Warning
                            </Tag>
                            <text.span size={-1}>{op.warning}</text.span>
                          </div>
                        )}
                        {op.diff && (
                          <details className="mt-1">
                            <summary className="cursor-pointer">
                              <text.span size={-1} emphasis="passive" className="hover:text-foreground">
                                View diff
                              </text.span>
                            </summary>
                            <div className="mt-1 border border-border rounded-md p-1 bg-muted">
                              <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                                {op.diff}
                              </pre>
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-2 p-1.5 bg-intents-ux-feedbackCritical-feedbackColor/10 border border-intents-ux-feedbackCritical-feedbackColor/30 rounded-md">
              <Tag emphasis="critical" size="sm" className="mb-1">
                Error
              </Tag>
              <text.p size={0} className="whitespace-pre-wrap">{error}</text.p>
            </div>
          )}

          {/* Warning */}
          {warning && (
            <div className="mb-2 p-1.5 border rounded-md">
              <Tag emphasis="warning" size="sm" className="mb-1">
                Warning
              </Tag>
              <text.p size={0} className="whitespace-pre-wrap">{warning}</text.p>
            </div>
          )}

          {/* Diff */}
          {diff && (
            <div className="mb-2">
              <text.p size={0} className="mb-1">
                Diff
              </text.p>
              <div className="border border-border rounded-md p-2 bg-muted max-h-48 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {diff}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolModal>
  )

  return (
    <div>
      <ToolHeader
        icon={<EditIcon width={16} height={16} />}
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
