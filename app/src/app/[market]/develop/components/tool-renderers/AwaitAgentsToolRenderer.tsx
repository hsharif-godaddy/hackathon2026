'use client'

import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react'
import { useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { type AwaitedJobResult } from '@/stores/useStreamingConversationStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { getToolIcon } from './toolIcons'
import ToolModal from './ToolModal'

function jobLabel(job: AwaitedJobResult): string {
  return job.title || job.agent || job.jobId
}

/**
 * Slim "join barrier" renderer for the awaitAgents tool.
 *
 * awaitAgents blocks the orchestrator until the listed sub-agent jobs finish.
 * The rich per-agent output lives on the individual runAgent cards, so this
 * renderer stays intentionally minimal: a one-line status while waiting, then a
 * completion count. Clicking opens a modal with each awaited job's outcome —
 * the durable record (runAgent cards are driven by live-only events).
 */
export default function AwaitAgentsToolRenderer({
  toolStatus,
  input,
  result,
}: DefaultToolRendererProps): React.ReactElement | null {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const jobIds = (input as { jobIds?: string[] } | undefined)?.jobIds ?? []
  const waitingCount = jobIds.length

  const results = (result as { results?: AwaitedJobResult[] } | undefined)?.results ?? []
  const isRunning = toolStatus === 'running'

  // A deliberate cancellation ('aborted') is NOT a failure — keep it distinct so
  // a user Stop doesn't render as a red error.
  const failed = results.filter((r) => r.status === 'error')
  const aborted = results.filter((r) => r.status === 'aborted')
  const succeeded = results.filter((r) => r.status === 'success')

  const hasFailure = !isRunning && failed.length > 0
  let label: string
  if (isRunning) {
    label = t('builder_tools_active_await_agents', { count: waitingCount }, 'Waiting for {count, plural, one {# task} other {# tasks}} to finish')
  } else if (failed.length > 0) {
    label = t('builder_subagent_await_failed', { failed: failed.length, total: results.length }, '{failed, plural, one {# task} other {# tasks}} failed of {total}')
  } else if (aborted.length > 0) {
    label = t('builder_subagent_await_stopped', { stopped: aborted.length, total: results.length }, '{stopped, plural, one {# task} other {# tasks}} stopped of {total}')
  } else {
    label = t('builder_subagent_await_complete', { count: succeeded.length || results.length }, '{count, plural, one {# task} other {# tasks}} complete')
  }

  const hasDetails = results.length > 0
  // Single boxless line: the standard tool icon sits inline at line height.
  const baseClass = 'my-1 flex items-center gap-1.5'
  const interactiveProps = hasDetails
    ? {
        role: 'button' as const,
        tabIndex: 0,
        className: `${baseClass} cursor-pointer group`,
        onClick: () => setIsModalOpen(true),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') setIsModalOpen(true)
        },
      }
    : { className: baseClass }

  return (
    <>
      <div data-testid="await-agents-renderer" {...interactiveProps}>
        <span className={`flex-shrink-0 ${hasFailure ? 'text-intents-ux-textDanger-color' : 'text-intents-ux-textLowContrast-color'}`}>
          {getToolIcon('awaitAgents')}
        </span>
        <span
          className={`text-xs truncate flex-1 ${isRunning ? 'text-shimmer' : hasFailure ? 'text-intents-ux-textDanger-color' : 'text-intents-ux-text-textColor'}${hasDetails ? ' group-hover:underline' : ''}`}
        >
          {label}
        </span>
      </div>

      {hasDetails && (
        <ToolModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={t('builder_subagent_await_modal_title', undefined, 'Awaited tasks')}>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {results.map((job) => {
              const jobFailed = job.status === 'error'
              const jobAborted = job.status === 'aborted'
              const detail = job.error || job.summary
              return (
                <div key={job.jobId} className="flex items-start gap-2">
                  {jobFailed ? (
                    <XCircle className="w-3.5 h-3.5 mt-0.5 text-intents-ux-textDanger-color flex-shrink-0" />
                  ) : jobAborted ? (
                    <CircleSlash className="w-3.5 h-3.5 mt-0.5 text-intents-ux-textLowContrast-color flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-intents-ux-textSuccess-color flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-intents-ux-text-textColor truncate">{jobLabel(job)}</div>
                    {detail && (
                      <div className="text-xs text-intents-ux-textLowContrast-color line-clamp-3">
                        {detail.split('\n')[0]}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-intents-ux-textLowContrast-color flex-shrink-0">{job.status}</span>
                </div>
              )
            })}
          </div>
        </ToolModal>
      )}
    </>
  )
}
