'use client'

import { useState, useEffect, useRef } from 'react'
import KeyValueTable from './KeyValueTable'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { completePartialJson } from './json-completion-utils'

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
        filePath = parsedResult.path || ''
        filename = getFilename(filePath)
        mode = parsedResult.mode || 'edit'
        changes = parsedResult.changes || null
        diff = parsedResult.diff || ''
        error = parsedResult.error || ''
        warning = parsedResult.warning || ''
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

  // Build compact display message - format: "Edit: filename +5 -5"
  let displayMessage = `${verb}: ${filename}`
  
  // Use streaming changes if available (tool is running), otherwise use final changes
  const displayChanges = streamingChanges || changes
  if (displayChanges && mode !== 'create') {
    displayMessage += ` +${displayChanges.additions} -${displayChanges.deletions}`
  } else if (streamingChanges && mode === 'create') {
    // For create mode, show line count as it streams
    displayMessage += ` +${streamingChanges.additions}`
  }

  // Has details if we have parsed result data (diff, metadata, etc.) OR markdown content
  const hasDetails = Boolean(
    (parsedResult && (diff || changes || error || warning || filePath)) || 
    isMarkdownFormat
  )

  // Build metadata for modal
  const metadata: Record<string, any> = {}
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

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={`${verb} ${filename}`}
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
        <>
          {/* Metadata */}
          {Object.keys(metadata).length > 0 && (
            <div className="mb-4">
              <KeyValueTable data={metadata} />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
              <div className="text-sm font-bold text-destructive mb-1">Error</div>
              <div className="text-sm text-destructive-foreground whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {/* Warning */}
          {warning && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <div className="text-sm font-bold text-yellow-800 mb-1">Warning</div>
              <div className="text-sm text-yellow-700 whitespace-pre-wrap">{warning}</div>
            </div>
          )}

          {/* Diff */}
          {diff && (
            <div className="flex-1 overflow-y-auto">
              <div className="text-sm font-bold mb-2">Diff</div>
              <div className="border border-border rounded-md p-4 bg-muted">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {diff}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </ToolModal>
  )

  return (
    <div className="-my-2">
      <ToolHeader
        icon="📝"
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}

