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
 * Count line changes from parsed JSON object
 *
 * Extracts additions and deletions from either edits array or content field.
 *
 * @param parsed - Parsed JSON object with edits array or content field
 * @returns Object with additions and deletions counts
 */
function countLinesFromParsed(parsed: any): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0

  if (parsed.edits && Array.isArray(parsed.edits)) {
    // Edit mode: count lines in edits array
    for (const edit of parsed.edits) {
      if (edit.old && typeof edit.old === 'string') {
        deletions += (edit.old.match(/\n/g) || []).length
      }
      if (edit.new && typeof edit.new === 'string') {
        additions += (edit.new.match(/\n/g) || []).length
      }
    }
  } else if (parsed.content && typeof parsed.content === 'string') {
    // Rewrite/create mode: count lines in content
    additions = (parsed.content.match(/\n/g) || []).length
  }

  return { additions, deletions }
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

  useEffect(() => {
    setMounted(true)
  }, [])

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
  let isBatchResult = false
  let batchOperations: any[] = []
  let totalOperations = 0
  let completedOperations = 0
  let commitHash = ''

  // For streaming: estimate line counts from partial input if tool is running
  let streamingChanges: { additions: number; deletions: number } | null = null
  let streamingPath: string | null = null
  let streamingMode: string | null = null
  if (toolStatus === 'running' && partialInput) {
    const currentEstimate = estimateLineCountsFromPartial(partialInput)

    // If parsing succeeded, update the last successful estimate
    if (currentEstimate) {
      lastSuccessfulEstimateRef.current = currentEstimate
      streamingChanges = currentEstimate
    } else {
      // If parsing failed, use the last successful estimate (if available)
      streamingChanges = lastSuccessfulEstimateRef.current
    }

    // Try to extract path using regex (works on incomplete JSON)
    const pathMatch = partialInput.match(/"path"\s*:\s*"([^"]+)"/)
    if (pathMatch) {
      streamingPath = pathMatch[1]
    }

    // Try to extract mode using regex (works on incomplete JSON)
    const modeMatch = partialInput.match(/"mode"\s*:\s*"(edit|create|rewrite|delete)"/)
    if (modeMatch) {
      streamingMode = modeMatch[1]
    }
  }

  // Reset last successful estimate when tool completes
  useEffect(() => {
    if (toolStatus !== 'running') {
      lastSuccessfulEstimateRef.current = null
    }
  }, [toolStatus])

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
          isBatchResult = true
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
        } else {
          // Single operation result
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

  if (isBatchResult) {
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
    (parsedResult && (diff || changes || error || warning || filePath || isBatchResult)) ||
    isMarkdownFormat
  )

  // Build metadata for modal
  const metadata: Record<string, any> = {}

  if (isBatchResult) {
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

  const modalTitle = isBatchResult ? 'File Operations' : `${verb} ${filename}`

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
          {isBatchResult && batchOperations.length > 0 && (
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
