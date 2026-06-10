'use client'

import { CheckCircle2, ChevronDown, ChevronUp, FileText, Globe, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
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

function dedupByLabel(outputs: VisualOutput[]): VisualOutput[] {
  const seen = new Set<string>()
  return outputs.filter(o => {
    if (seen.has(o.label)) return false
    seen.add(o.label)
    return true
  })
}

export default function RunAgentToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps): React.ReactElement | null {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isActivityExpanded, setIsActivityExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const events = useStreamingConversationStore((state) => state.subagentEvents[toolId ?? '']) ?? EMPTY_EVENTS
  const openDoc = useDevelopPageStore((state) => state.openDoc)
  const openPreviewPage = useDevelopPageStore((state) => state.openPreviewPage)

  useEffect(() => {
    if (isActivityExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isActivityExpanded, events.length])

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
  const pageOutputs = dedupByLabel(visualOutputs?.filter(o => o.type === 'page') ?? [])
  const docOutputs = dedupByLabel(visualOutputs?.filter(o => o.type === 'doc') ?? [])

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
          <span className="text-xs text-intents-ux-text-textColor truncate flex-1">
            {displayLabel}
          </span>
          {toolStatus === 'running' && latestDetail && (
            <span className="text-xs text-intents-ux-textLowContrast-color truncate max-w-[200px]">
              {latestDetail}
            </span>
          )}
        </div>

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
          <div className="grid grid-cols-2 gap-1 mt-2 ml-5">
            {pageOutputs.map((output, i) => (
              <button
                key={i}
                type="button"
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border border-intents-ux-borderLowContrast-color text-intents-ux-text-textColor hover:bg-intents-ux-surface-subtle-fillColor"
                onClick={(e) => { e.stopPropagation(); openPreviewPage(output.url ?? output.label) }}
              >
                <Globe className="w-3 h-3 flex-shrink-0" />
                {output.label}
              </button>
            ))}
          </div>
        )}

        {toolStatus === 'completed' && docOutputs.length > 0 && (() => {
          const pageLabels = new Set(pageOutputs.map(p => p.label))
          const filtered = docOutputs.filter(o => !pageLabels.has(o.label))
          if (filtered.length === 0) return null
          return (
            <div className="flex flex-col gap-0.5 mt-2 ml-5" onClick={(e) => e.stopPropagation()}>
              {filtered.map((output, i) => {
                const path = output.url ?? output.label
                const isPageRoute = path.startsWith('/')
                return (
                  <button
                    key={i}
                    type="button"
                    className="flex items-center gap-1 text-xs text-intents-ux-textAction-color hover:underline"
                    onClick={() => { if (isPageRoute) { openPreviewPage(path) } else { openDoc(path) } }}
                  >
                    {isPageRoute ? <Globe className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                    {output.label}
                  </button>
                )
              })}
            </div>
          )
        })()}

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
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-intents-ux-textLowContrast-color">
                {[...new Set(typedResult.artifacts)].map((f) => (
                  <div key={f} className="truncate">{f}</div>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-semibold mb-1 hover:text-intents-ux-textAction-color"
                onClick={() => setIsActivityExpanded(!isActivityExpanded)}
              >
                Activity ({events.length})
                {isActivityExpanded
                  ? <ChevronUp className="w-3.5 h-3.5" />
                  : <ChevronDown className="w-3.5 h-3.5" />
                }
              </button>
              {isActivityExpanded ? (
                <div
                  ref={scrollRef}
                  className="max-h-40 overflow-y-auto rounded bg-intents-ux-surface-subtle-fillColor p-2"
                >
                  {events.map((e, i) => (
                    <div key={i} className="text-xs text-intents-ux-textLowContrast-color py-0.5 truncate">
                      {e.detail}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-intents-ux-textLowContrast-color truncate">
                  {latestDetail}
                </div>
              )}
            </div>
          )}
        </div>
      </ToolModal>
    </>
  )
}
