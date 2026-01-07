'use client'

import { Wrench } from 'lucide-react'
import { useState } from 'react'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { getToolDisplayName } from '@/utils/toolNameMapping'

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
  partialInput?: string
  /** Whether this tool is in the last assistant message (used to disable interactive forms after user responds) */
  isLastAssistantMessage?: boolean
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
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)

  const hasDetails = Boolean(result || error || (input && Object.keys(input).length > 0))

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div>
      <ToolHeader
        icon={<Wrench className="w-2 h-2" />}
        displayName={getToolDisplayName(toolName)}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={getToolDisplayName(toolName)}
      >
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Duration */}
          {duration && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_default_duration')}</div>
              <div className="text-sm">{formatDuration(duration)}</div>
            </div>
          )}

          {/* Input */}
          {input && Object.keys(input).length > 0 && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_default_arguments')}</div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-1.5 rounded border border-border max-h-32 overflow-y-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && !error && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_default_output')}</div>
              <div className="bg-muted p-1.5 rounded border border-border max-h-48 overflow-y-auto">
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
              <div className="text-sm font-bold mb-1 text-destructive">{t('builder_status_error')}</div>
              <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
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
