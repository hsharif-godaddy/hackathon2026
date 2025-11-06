'use client'

import { useState, useEffect } from 'react'
import KeyValueTable from './KeyValueTable'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

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
 * Custom renderer for fileEdit tool
 * 
 * Shows mode-aware message: "Created {filename}", "Edit {filename} (+5 -3)", etc.
 * Clickable to show modal with full diff and metadata.
 */
export default function FileEditToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

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

  const verb = getModeVerb(mode)

  // Build compact display message - format: "Edit: filename +5 -5"
  let displayMessage = `${verb}: ${filename}`
  if (changes && mode !== 'create') {
    displayMessage += ` +${changes.additions} -${changes.deletions}`
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

