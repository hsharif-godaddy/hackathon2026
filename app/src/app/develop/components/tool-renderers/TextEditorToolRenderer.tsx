'use client'

import { useEffect, useRef, useState } from 'react'
import EditIcon from '@ux/icon/edit'
import Tag from '@ux/tag'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import { completePartialJson } from '@/app/develop/components/tool-renderers/json-completion-utils'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Count lines in a string.
 * Trailing newlines are ignored so "line1\nline2\n" counts as 2 lines.
 */
function countLines(text: string): number {
  if (!text) return 0
  const trimmed = text.replace(/\n+$/, '')
  if (!trimmed) return 1
  return trimmed.split('\n').length
}

/**
 * Parse textEditor input to extract operation details
 */
function parseTextEditorInput(input: any): {
  command: 'view' | 'str_replace' | 'create' | 'insert'
  path: string
  filename: string
  additions: number
  deletions: number
} | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const command = input.command
  const path = input.path || ''
  const filename = getFilename(path)

  let additions = 0
  let deletions = 0

  switch (command) {
    case 'str_replace':
      // Count lines in old_str and new_str
      if (input.old_str) {
        deletions = countLines(input.old_str)
      }
      if (input.new_str) {
        additions = countLines(input.new_str)
      }
      break

    case 'create':
      // Count lines in file_text
      if (input.file_text) {
        additions = countLines(input.file_text)
      }
      break

    case 'insert':
      // Count lines in insert_text
      if (input.insert_text) {
        additions = countLines(input.insert_text)
      }
      break

    case 'view':
      // No changes for view
      break

    default:
      return null
  }

  return {
    command,
    path,
    filename,
    additions,
    deletions
  }
}

/**
 * Estimate line counts from partial streaming input
 *
 * Attempts to complete partial JSON and extract line counts from whatever
 * fields are available (old_str, new_str, file_text, insert_text).
 */
export function estimateLineCountsFromPartial(partialInput: string): { additions: number; deletions: number } | null {
  if (!partialInput || partialInput.length < 20) {
    return null
  }

  // First, try to parse as complete JSON (fastest path)
  try {
    const parsed = JSON.parse(partialInput)
    const operation = parseTextEditorInput(parsed)
    if (operation) {
      return { additions: operation.additions, deletions: operation.deletions }
    }
    return null
  } catch {
    // JSON is incomplete, try to complete it
  }

  // Try to complete the partial JSON
  const completedJson = completePartialJson(partialInput)
  if (!completedJson) {
    return null
  }

  // Try to parse the completed JSON
  try {
    const parsed = JSON.parse(completedJson)
    const operation = parseTextEditorInput(parsed)
    if (operation) {
      return { additions: operation.additions, deletions: operation.deletions }
    }
  } catch {
    // Parsing failed, return null to use last successful estimate
    return null
  }

  return null
}

/**
 * Get display verb for command
 */
function getCommandVerb(command: string, t: (key: string) => string): string {
  const verbMap: Record<string, string> = {
    'view': t('builder_common_view'),
    'str_replace': t('builder_common_edit'),
    'create': t('builder_common_created'),
    'insert': t('builder_common_insert')
  }
  return verbMap[command] || command
}

/**
 * Custom renderer for textEditor tool
 *
 * Shows command-aware message: "Created: Button.tsx +50", "Edit: App.tsx +5 -3", etc.
 * Shows streaming line counts as they arrive.
 * Clickable to show modal with full input parameters and result.
 */
export default function TextEditorToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result,
  partialInput,
  error: toolCallError
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const lastSuccessfulEstimateRef = useRef<{ additions: number; deletions: number } | null>(null)
  const [streamingEstimate, setStreamingEstimate] = useState<{ additions: number; deletions: number } | null>(null)

  /**
   * Manage streaming estimate lifecycle
   *
   * Updates line count estimates in real-time as partial JSON arrives during streaming.
   * Falls back to last successful estimate if parsing fails.
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

  // Parse input to extract operation details.
  // During streaming, `input` is empty - fall back to parsing partialInput.
  let operation = parseTextEditorInput(input)
  if (!operation && partialInput) {
    try {
      const completed = completePartialJson(partialInput)
      if (completed) {
        operation = parseTextEditorInput(JSON.parse(completed))
      }
    } catch { /* partial JSON not parseable yet */ }
  }

  // Build compact display message
  let displayMessage: string | React.ReactNode = ''

  if (operation) {
    const verb = getCommandVerb(operation.command, t)

    // Format: "Edit: filename +5 -3" or "Created: filename +50"
    displayMessage = `${verb}: ${operation.filename}`

    // Use streaming estimates if available (tool is running), otherwise use final values
    const additions = streamingEstimate?.additions ?? operation.additions
    const deletions = streamingEstimate?.deletions ?? operation.deletions

    if (operation.command === 'create' && additions > 0) {
      // For create, show only additions
      displayMessage += ` +${additions}`
    } else if (operation.command === 'str_replace') {
      // For edits, show additions and deletions
      displayMessage += ` +${additions} -${deletions}`
    } else if (operation.command === 'insert' && additions > 0) {
      // For insert, show additions
      displayMessage += ` +${additions}`
    }
    // For view, no line counts
  } else {
    // Fallback if parsing fails
    displayMessage = 'Text Editor'
  }

  // Has details if we have input or result or error
  const hasDetails = Boolean(input || result || toolCallError)

  const modalTitle = operation ? `${getCommandVerb(operation.command, t)} ${operation.filename}` : 'Text Editor'

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={modalTitle}
    >
      <div className="flex-1 overflow-y-auto">
        {/* Input parameters - show when there's a tool call error for debugging */}
        {toolCallError && input && (
          <div className="mb-2">
            <text.p className="mb-1" size={0}>
              Input Parameters
            </text.p>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-1.5 rounded border border-border max-h-48 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
        )}

        {/* Tool Call Error (invalid parameters, validation errors, etc.) */}
        {toolCallError && (
          <div className="mb-2 p-1.5 bg-intents-ux-feedbackCritical-feedbackColor/10 border border-intents-ux-feedbackCritical-feedbackColor/30 rounded-md">
            <Tag emphasis="critical" size="sm" className="mb-1">
              Tool Call Error
            </Tag>
            <text.p size={0} className="whitespace-pre-wrap">{toolCallError}</text.p>
          </div>
        )}

        {/* View Result - file contents */}
        {!toolCallError && result && operation?.command === 'view' && (
          <div className="mb-2">
            <text.p className="mb-1" size={0}>
              File Contents
            </text.p>
            <div className="border border-border rounded-md p-2 bg-muted max-h-96 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Success Message - all non-view commands */}
        {!toolCallError && result && operation?.command !== 'view' && (
          <div className="mb-2 p-1.5 bg-intents-ux-feedbackPositive-feedbackColor/10 border border-intents-ux-feedbackPositive-feedbackColor/30 rounded-md">
            <Tag emphasis="success" size="sm" className="mb-1">
              {t('builder_status_success')}
            </Tag>
            <text.p size={0} className="whitespace-pre-wrap">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </text.p>
          </div>
        )}
      </div>
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
