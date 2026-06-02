'use client'

import { CheckCircle2, FileText, Globe, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolModal from './ToolModal'

const EMPTY_EVENTS: Array<{ detail: string }> = []

interface VisualOutput {
  type: 'media' | 'page' | 'doc'
  label: string
  url?: string
  thumbnailUrl?: string
}

function ensureHttps(url: string): string {
  if (url.startsWith('http://')) return url.replace('http://', 'https://')
  return url
}

function truncateTask(task: string, max: number): string {
  const firstLine = task.split('\n')[0] ?? task
  return firstLine.length > max ? firstLine.slice(0, max) + '...' : firstLine
}

export default function RunAgentToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps): React.ReactElement | null {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const events = useStreamingConversationStore((state) => state.subagentEvents[toolId ?? '']) ?? EMPTY_EVENTS

  const mode: string | undefined = (input as { mode?: string } | undefined)?.mode
  if (mode === 'interactive') return null

  const title: string = (input as { title?: string } | undefined)?.title ?? ''
  const task: string = (input as { task?: string } | undefined)?.task ?? ''
  const typedResult = result as {
    summary?: string
    artifacts?: string[]
    status?: string
    docPath?: string
    visualOutputs?: VisualOutput[]
  } | undefined
  const isError: boolean = typedResult?.status === 'error'

  const latestDetail: string = events.length > 0 ? events[events.length - 1]!.detail : ''

  const statusIcon = isError
    ? <XCircle className="w-3 h-3 text-intents-ux-textDanger-color flex-shrink-0" />
    : toolStatus === 'completed'
      ? <CheckCircle2 className="w-3 h-3 text-intents-ux-textSuccess-color flex-shrink-0" />
      : toolStatus === 'running'
        ? <Loader2 className="w-3 h-3 text-intents-ux-textLowContrast-color animate-spin flex-shrink-0" />
        : null

  const visualOutputs = typedResult?.visualOutputs
  const mediaOutputs = visualOutputs?.filter(o => o.type === 'media') ?? []
  const pageOutputs = visualOutputs?.filter(o => o.type === 'page') ?? []
  const docOutputs = visualOutputs?.filter(o => o.type === 'doc') ?? []

  const displayLabel = title || truncateTask(task, 80) || 'Sub-agent task'

  return (
    <>
      <div
        className="rounded-md border border-intents-ux-borderLowContrast-color p-2.5 my-2 cursor-pointer hover:bg-intents-ux-surface-subtle-fillColor transition-colors"
        data-testid="run-agent-renderer"
        onClick={() => setIsModalOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsModalOpen(true) }}
      >
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-xs text-intents-ux-text-textColor truncate">
            {displayLabel}
          </span>
        </div>

        {toolStatus === 'running' && latestDetail && (
          <div className="text-xs text-intents-ux-textLowContrast-color mt-1 ml-5 truncate">
            {latestDetail}
          </div>
        )}

        {toolStatus === 'completed' && mediaOutputs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 ml-5" onClick={(e) => e.stopPropagation()}>
            {mediaOutputs.slice(0, 6).map((output, i) => (
              <div key={i} className="w-12 h-12 rounded overflow-hidden border border-intents-ux-borderLowContrast-color">
                {(output.thumbnailUrl || output.url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ensureHttps(output.thumbnailUrl ?? output.url!)}
                    alt={output.label}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-intents-ux-surface-subtle-fillColor flex items-center justify-center">
                    <FileText className="w-4 h-4 text-intents-ux-textLowContrast-color" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {toolStatus === 'completed' && pageOutputs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 ml-5">
            {pageOutputs.map((output, i) => (
              <span
                key={i}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded border border-intents-ux-borderLowContrast-color text-intents-ux-text-textColor"
              >
                <Globe className="w-3 h-3" />
                {output.label}
              </span>
            ))}
          </div>
        )}

        {toolStatus === 'completed' && docOutputs.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-2 ml-5" onClick={(e) => e.stopPropagation()}>
            {docOutputs.map((output, i) => (
              <button
                key={i}
                type="button"
                className="flex items-center gap-1 text-xs text-intents-ux-textAction-color hover:underline"
                onClick={() => void 0}
              >
                <FileText className="w-3 h-3" />
                {output.label}
              </button>
            ))}
          </div>
        )}

        {toolStatus === 'completed' && typedResult?.docPath && !docOutputs.some(o => o.url === typedResult.docPath) && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-intents-ux-textAction-color hover:underline mt-1.5 ml-5"
            onClick={(e) => { e.stopPropagation(); void 0 }}
          >
            <FileText className="w-3 h-3" />
            {typedResult.docPath}
          </button>
        )}

        {isError && typedResult?.summary && (
          <div className="text-xs mt-1.5 ml-5 text-intents-ux-textDanger-color truncate">
            {typedResult.summary.split('\n')[0]?.slice(0, 100)}
          </div>
        )}
      </div>

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={displayLabel}
      >
        <div className="flex-1 overflow-y-auto space-y-4">
          {typedResult?.summary && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownRenderer content={typedResult.summary} />
            </div>
          )}

          {typedResult?.artifacts && typedResult.artifacts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Files</h3>
              <ul className="text-xs space-y-0.5 text-intents-ux-textLowContrast-color">
                {typedResult.artifacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {events.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Activity</h3>
              <ul className="text-xs space-y-0.5 text-intents-ux-textLowContrast-color">
                {events.map((e, i) => (
                  <li key={i}>{e.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ToolModal>
    </>
  )
}
