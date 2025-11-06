'use client'

import { useState, useEffect } from 'react'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import { getToolDisplayName } from '../../../../utils/toolNameMapping'

/**
 * Props for the default tool renderer
 */
export interface DefaultToolRendererProps {
  toolName: string
  toolStatus: 'running' | 'completed' | 'error'
  duration?: number
  input?: Record<string, unknown>
  result?: Record<string, unknown> | string
  error?: string
  startTime?: number
  endTime?: number
}

/**
 * Default tool renderer with subtle, compact design
 * 
 * Renders tool calls with minimal visual footprint - light gray text with
 * tool name and a small status indicator (spinner/X for errors).
 * Click to open modal with full details.
 * 
 * @param props - Tool call information
 * @returns Rendered tool call component
 */
export default function DefaultToolRenderer({
  toolName,
  toolStatus,
  duration,
  input,
  result,
  error,
  startTime: _startTime,
  endTime: _endTime
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const hasDetails = Boolean(result || error || (input && Object.keys(input).length > 0))

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="-my-2">
      <ToolHeader
        icon="🔧"
        displayName={getToolDisplayName(toolName)}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={getToolDisplayName(toolName)}
        mounted={mounted}
      >
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Duration */}
          {duration && (
            <div>
              <div className="text-sm font-bold mb-2">Duration</div>
              <div className="text-sm">{formatDuration(duration)}</div>
            </div>
          )}

          {/* Input */}
          {input && Object.keys(input).length > 0 && (
            <div>
              <div className="text-sm font-bold mb-2">Arguments</div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded border border-border max-h-64 overflow-y-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && !error && (
            <div>
              <div className="text-sm font-bold mb-2">Output</div>
              <div className="bg-muted p-3 rounded border border-border max-h-96 overflow-y-auto">
                <MarkdownRenderer
                  content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                  className="text-sm leading-relaxed break-words"
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div>
              <div className="text-sm font-bold mb-2 text-destructive">Error</div>
              <div className="bg-destructive/10 border border-destructive/30 p-3 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                  {error}
                </pre>
              </div>
            </div>
          )}
        </div>
      </ToolModal>
    </div>
  )
}

