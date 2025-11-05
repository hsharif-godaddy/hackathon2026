'use client'

import { useState, useMemo } from 'react'
import AlertIcon from '@ux/icon/alert'
import FullscreenModal from '../FullscreenModal'
import MarkdownRenderer from '../MarkdownRenderer'
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
 * Click to expand and show full details in a card.
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
  startTime,
  endTime
}: DefaultToolRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasDetails = Boolean(result || error || (input && Object.keys(input).length > 0))

  const getStatusIndicator = () => {
    switch (toolStatus) {
      case 'running':
        return (
          <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )
      case 'error':
        return <AlertIcon className="w-2.5 h-2.5" />
      default:
        return null
    }
  }

  const getStatusColor = () => {
    switch (toolStatus) {
      case 'running':
        return 'text-gray-300'
      case 'error':
        return 'text-red-500'
      default:
        return ''
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const layoutId = useMemo(() =>
    `tool-output-${toolName}-${input ? JSON.stringify(input).slice(0, 20) : 'no-args'}-${result ? String(result).slice(0, 20) : 'no-result'}`.replace(/[^a-zA-Z0-9-]/g, '-'),
    [toolName, input, result]
  )

  const statusIndicator = getStatusIndicator()

  return (
    <div className="-my-2">
      {/* Compact header - inline with text */}
      <span className="text-gray-300 text-xs">
        <span className="text-gray-400">🔧</span>
        {' '}
        <span
          className={hasDetails ? 'cursor-pointer hover:underline' : ''}
          onClick={hasDetails ? () => setIsExpanded(!isExpanded) : undefined}
        >
          {getToolDisplayName(toolName)}
          {statusIndicator && (
            <span className={`inline-flex ml-1.5 ${getStatusColor()}`}>
              {statusIndicator}
            </span>
          )}
        </span>
      </span>

      {/* Expandable details card */}
      {isExpanded && hasDetails && (
        <div className="mt-2 mb-4 px-3 py-3 space-y-3 rounded-md bg-intents-ux-boxLowContrast-backgroundColor shadow-sm">
          {/* Duration */}
          {duration && (
            <div className="flex items-center gap-2">
              <div className="text-xs font-bold">Duration</div>
              <div className="text-xs">{formatDuration(duration)}</div>
            </div>
          )}

          {/* Input */}
          {input && Object.keys(input).length > 0 && (
            <div>
              <div className="text-xs font-bold mb-1">Arguments</div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-intents-ux-box-backgroundColor shadow-md p-2 rounded text-left max-h-32 overflow-y-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-bold">
                  {error ? 'Error' : 'Output'}
                </div>
                {!error && (
                  <FullscreenModal
                    content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                    toolName={toolName}
                    layoutId={layoutId}
                    type="markdown"
                  />
                )}
              </div>
              <div className="bg-intents-ux-box-backgroundColor shadow-md p-2 rounded max-h-64 overflow-y-auto">
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
              <div className="text-xs font-bold mb-1">Error</div>
              <div className="bg-intents-ux-box-backgroundColor shadow-md p-2 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono">
                  {error}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

