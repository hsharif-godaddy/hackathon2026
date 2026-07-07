'use client'

import { ChevronDown, ChevronUp, FileText, Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useAwaitedJobResult, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { deriveSubAgentLifecycle, parseSubagentOutputs } from '@/utils/subagentStatus'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { getToolIcon } from './toolIcons'
import ToolModal from './ToolModal'

const EMPTY_EVENTS: Array<{ event: string; agent: string; detail: string }> = []

// Events that carry machine payloads (JSON) rather than human-readable progress
// text — excluded from the inline detail line and the activity log.
const NON_PROGRESS_EVENTS = new Set(['outputs', 'usage', 'completed', 'error'])

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
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isActivityExpanded, setIsActivityExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const events = useStreamingConversationStore((state) => state.subagentEvents[toolId ?? '']) ?? EMPTY_EVENTS
  const openDoc = useDevelopPageStore((state) => state.openDoc)
  const openPreviewPage = useDevelopPageStore((state) => state.openPreviewPage)
  // Durable terminal status for after a reload, when live events are gone.
  const jobId: string | undefined = (result as { jobId?: string } | undefined)?.jobId
  const awaited = useAwaitedJobResult(jobId)

  useEffect(() => {
    if (isActivityExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isActivityExpanded, events.length])

  const mode: string | undefined = (input as { mode?: string } | undefined)?.mode
  if (mode === 'interactive') return null

  const title: string = (input as { title?: string } | undefined)?.title ?? ''
  const task: string = (input as { task?: string } | undefined)?.task ?? ''

  // The sub-agent runs detached: its true lifecycle and final outputs arrive on
  // the event stream (the `outputs` event), not on the runAgent tool result
  // (which now only carries { jobId, status: 'running' }). After a reload the
  // events are gone, so fall back to the persisted awaitAgents result for this
  // job, then to the tool result (blocking-mode/legacy payloads).
  const lifecycle = deriveSubAgentLifecycle(events, toolStatus, awaited?.status)
  const outputs = parseSubagentOutputs(events)
  const legacyResult = result as {
    summary?: string
    artifacts?: string[]
    status?: string
    docPath?: string
    visualOutputs?: VisualOutput[]
  } | undefined

  const summary: string | undefined = outputs?.summary ?? awaited?.summary ?? awaited?.error ?? legacyResult?.summary
  const artifacts: string[] | undefined = outputs?.artifacts ?? awaited?.artifacts ?? legacyResult?.artifacts
  const visualOutputs = (outputs?.visualOutputs ?? legacyResult?.visualOutputs) as VisualOutput[] | undefined

  const isRunning = lifecycle === 'running'
  // A timeout is an involuntary failure (the per-task backstop stopped a hung
  // worker), so render it with the error treatment — its summary carries the
  // "timed out after Nms" reason — rather than the user-initiated "Stopped" chip.
  const isError = lifecycle === 'error' || lifecycle === 'timeout'
  const isDone = lifecycle === 'success'
  const isAborted = lifecycle === 'aborted'

  const progressEvents = events.filter((e) => !NON_PROGRESS_EVENTS.has(e.event))
  const latestDetail: string = progressEvents.length > 0 ? progressEvents[progressEvents.length - 1]!.detail : ''

  const mediaOutputs = visualOutputs?.filter(o => o.type === 'media') ?? []
  const pageOutputs = dedupByLabel(visualOutputs?.filter(o => o.type === 'page') ?? [])
  const docOutputs = dedupByLabel(visualOutputs?.filter(o => o.type === 'doc') ?? [])

  const displayLabel = title || truncateTask(task, 80) || t('builder_subagent_run_fallback_title', undefined, 'Sub-agent task')

  return (
    <>
      <div
        className="my-1.5 cursor-pointer group"
        data-testid="run-agent-renderer"
        onClick={() => setIsModalOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsModalOpen(true) }}
      >
        <div className="flex items-center gap-1.5">
          <span className={`flex-shrink-0 ${isError ? 'text-intents-ux-textDanger-color' : 'text-intents-ux-textLowContrast-color'}`}>
            {getToolIcon('runAgent')}
          </span>
          <span
            className={
              isRunning
                ? 'text-xs text-shimmer truncate flex-1'
                : `text-xs truncate flex-1 group-hover:underline ${isError ? 'text-intents-ux-textDanger-color' : isAborted ? 'text-intents-ux-textLowContrast-color' : 'text-intents-ux-text-textColor'}`
            }
          >
            {displayLabel}
          </span>
          {isAborted && (
            <span className="text-xs text-intents-ux-textLowContrast-color flex-shrink-0">{t('builder_status_stopped', undefined, 'Stopped')}</span>
          )}
          {isRunning && latestDetail && (
            <span className="text-xs text-intents-ux-textLowContrast-color truncate max-w-[200px]">
              {latestDetail}
            </span>
          )}
        </div>

        {isDone && mediaOutputs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 ml-3.5" onClick={(e) => e.stopPropagation()}>
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

        {isDone && pageOutputs.length > 0 && (
          <div className="grid grid-cols-2 gap-1 mt-2 ml-3.5">
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

        {isDone && docOutputs.length > 0 && (() => {
          const pageLabels = new Set(pageOutputs.map(p => p.label))
          const filtered = docOutputs.filter(o => !pageLabels.has(o.label))
          if (filtered.length === 0) return null
          return (
            <div className="flex flex-col gap-0.5 mt-2 ml-3.5" onClick={(e) => e.stopPropagation()}>
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

        {isError && summary && (
          <div className="text-xs mt-1.5 ml-3.5 text-intents-ux-textDanger-color truncate">
            {summary.split('\n')[0]?.slice(0, 100)}
          </div>
        )}
      </div>

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={displayLabel}
      >
        <div className="flex-1 overflow-y-auto space-y-4">
          {summary && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownRenderer content={summary} />
            </div>
          )}

          {artifacts && artifacts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">{t('builder_common_files', undefined, 'Files')}</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-intents-ux-textLowContrast-color">
                {[...new Set(artifacts)].map((f) => (
                  <div key={f} className="truncate">{f}</div>
                ))}
              </div>
            </div>
          )}

          {progressEvents.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-semibold mb-1 hover:text-intents-ux-textAction-color"
                onClick={() => setIsActivityExpanded(!isActivityExpanded)}
              >
                {t('builder_subagent_run_activity', { count: progressEvents.length }, 'Activity ({count})')}
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
                  {progressEvents.map((e, i) => (
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
