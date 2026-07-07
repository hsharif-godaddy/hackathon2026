'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import AlertIcon from '@ux/icon/alert'
import ArrowLeftIcon from '@ux/icon/arrow-left'
import CheckmarkIcon from '@ux/icon/checkmark'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import ChevronRightIcon from '@ux/icon/chevron-right'
import SparklesIcon from '@ux/icon/sparkles'
import CloseIcon from '@ux/icon/x'
import text from '@ux/text'

import type { Automation } from '@/app/[market]/develop/components/automations/types'
import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import type { AutomationRun, AutomationRunStatus } from '@/hooks/useAutomationRuns'
import { PAGE_SIZE, useAutomationRuns } from '@/hooks/useAutomationRuns'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'
import { AppService } from '@/services/AppService'

interface RunsHistoryViewProps {
  appId: string | null
  automation: Automation
  hostedAutomationId: string
  onBack: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds?: number): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: AutomationRunStatus }) {
  const t = useTranslations()
  const label = (() => {
    switch (status) {
      case 'success': return t('builder_automations_run_status_success', undefined, 'Succeeded')
      case 'partial': return t('builder_automations_run_status_partial', undefined, 'Partial')
      case 'running': return t('builder_automations_run_status_running', undefined, 'Running')
      case 'pending': return t('builder_automations_run_status_pending', undefined, 'Pending')
      case 'cancelled': return t('builder_automations_run_status_cancelled', undefined, 'Cancelled')
      default: return t('builder_automations_run_status_failed', undefined, 'Failed')
    }
  })()
  const colorCls = (() => {
    switch (status) {
      case 'success': return 'text-intents-ux-positive-color'
      case 'partial': return 'text-intents-ux-warning-color'
      case 'failed': return 'text-intents-ux-critical-color'
      case 'cancelled': return 'text-intents-ux-neutral-color'
      default: return 'text-intents-ux-neutral-color'
    }
  })()
  const icon = (() => {
    switch (status) {
      case 'success': return <CheckmarkIcon className="size-3 shrink-0" />
      case 'partial': return <AlertIcon className="size-3 shrink-0" />
      case 'failed': return <AlertIcon className="size-3 shrink-0" />
      case 'cancelled': return <CloseIcon className="size-3 shrink-0" />
      case 'running':
      case 'pending': return <SpinnerIcon className="size-3 shrink-0" />
      default: return null
    }
  })()
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', colorCls)}>
      {icon}
      {label}
    </span>
  )
}

// ─── Summary modal ────────────────────────────────────────────────────────────

interface SummaryModalProps {
  run: AutomationRun
  appId: string
  onClose: () => void
}

// Strip internal-only frontmatter fields and reformat timestamp for user display.
// Removes: runId, conversationId. Formats: timestamp → locale string.
function cleanSummaryContent(raw: string): string {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!fmMatch) return raw
  const [, frontmatter, body] = fmMatch
  const cleaned = frontmatter
    .split('\n')
    .filter(line => !/^(runId|conversationId):/.test(line))
    .map(line => {
      const tsMatch = line.match(/^timestamp:\s*'?(.+?)'?\s*$/)
      if (tsMatch) {
        const d = new Date(tsMatch[1])
        if (!Number.isNaN(d.getTime())) {
          return `timestamp: ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
        }
      }
      return line
    })
    .join('\n')
  return `---\n${cleaned}\n---\n${body}`
}

function SummaryModal({ run, appId, onClose }: SummaryModalProps) {
  const t = useTranslations()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    AppService.getInstance()
      .readFile(appId, run.summaryRef!)
      .then(({ content: c }) => { if (!cancelled) { setContent(cleanSummaryContent(c)); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [appId, run.summaryRef])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex flex-col w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[75vh] rounded-t-2xl sm:rounded-2xl bg-develop-bg shadow-2xl border border-intents-ux-box-borderColor overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-intents-ux-box-borderColor shrink-0">
          <div className="flex flex-col min-w-0 flex-1">
            <text.p size={-1} className="font-semibold">
              {t('builder_automations_run_summary_title', undefined, 'Run Summary')}
            </text.p>
            <text.p size={-2} emphasis="passive">{formatDateTime(run.startedAt)}</text.p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('builder_automations_run_summary_close', undefined, 'Close summary')}
            className="shrink-0 p-1.5 rounded-lg text-intents-ux-neutral-color hover:bg-intents-ux-interactive-backgroundColor/30 transition-colors"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-intents-ux-neutral-color">
              <SpinnerIcon className="size-3.5" />
              <text.span size={-1} emphasis="passive">
                {t('builder_automations_run_summary_loading', undefined, 'Loading summary…')}
              </text.span>
            </div>
          )}
          {error && (
            <text.p size={-1} className="text-intents-ux-critical-color py-4">
              {t('builder_automations_run_summary_error', undefined, 'Could not load summary.')}
            </text.p>
          )}
          {content !== null && (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-intents-ux-text-color">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function RunsHistoryView({ appId, automation, hostedAutomationId, onBack }: RunsHistoryViewProps) {
  const t = useTranslations()
  const { runs, total, loading, fetched, fetch: fetchRuns } = useAutomationRuns(appId, hostedAutomationId)
  const [summaryRun, setSummaryRun] = useState<AutomationRun | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    void fetchRuns({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageRuns = runs

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 md:px-6 py-4 border-b border-intents-ux-box-borderColor shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-intents-ux-interactive-color hover:opacity-75 transition-opacity shrink-0"
          aria-label={t('builder_automations_runs_back', undefined, 'Back to automations')}
        >
          <ArrowLeftIcon className="size-3.5 shrink-0" />
          <text.span size={-1} className="font-medium">
            {t('builder_automations_runs_back_label', undefined, 'Back')}
          </text.span>
        </button>
        <div className="h-4 w-px bg-intents-ux-box-borderColor shrink-0" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="shrink-0 p-1.5 rounded-lg bg-intents-ux-actionPrimary-backgroundColor/20 border border-intents-ux-actionPrimary-borderColor/20">
            <SparklesIcon className="size-2.5 text-intents-ux-actionPrimary-backgroundColor" />
          </div>
          <text.p size={-1} className="font-semibold truncate">{automation.name}</text.p>
        </div>
        <div className="shrink-0 hidden sm:block">
          <text.p size={-2} emphasis="passive" className="font-semibold uppercase tracking-widest">
            {t('builder_automations_all_runs_title', undefined, 'Run History')}
          </text.p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {(!fetched && loading) ? (
          <div className="flex items-center gap-2 px-4 md:px-6 py-6 text-intents-ux-neutral-color">
            <SpinnerIcon className="size-3.5" />
            <text.span size={-1} emphasis="passive">
              {t('builder_automations_runs_loading', undefined, 'Loading…')}
            </text.span>
          </div>
        ) : (fetched && runs.length === 0) ? (
          <div className="px-4 md:px-6 py-6">
            <text.p size={-1} emphasis="passive">
              {t('builder_automations_runs_empty', undefined, 'No runs yet.')}
            </text.p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-intents-ux-box-borderColor/50">
              {pageRuns.map(run => (
                <div key={run.id} className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={run.status} />
                    <text.span size={-2} emphasis="passive">{formatDateTime(run.startedAt)}</text.span>
                  </div>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <div className="flex items-center gap-1.5">
                      <text.span size={-2} emphasis="passive" className="font-medium shrink-0">
                        {t('builder_automations_runs_col_type', undefined, 'Type')}
                      </text.span>
                      <text.span size={-2}>
                        {run.triggeredBy === 'manual'
                          ? t('builder_automations_run_triggered_manual', undefined, 'Manual')
                          : t('builder_automations_run_triggered_scheduled', undefined, 'Scheduled')
                        }
                      </text.span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <text.span size={-2} emphasis="passive" className="font-medium shrink-0">
                        {t('builder_automations_runs_col_duration', undefined, 'Duration')}
                      </text.span>
                      <text.span size={-2}>{formatDuration(run.durationSeconds)}</text.span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <text.span size={-2} emphasis="passive" className="font-medium shrink-0">
                        {t('builder_automations_runs_col_summary', undefined, 'Summary')}
                      </text.span>
                      {run.status === 'success' && run.summaryRef && appId
                        ? (
                          <button
                            type="button"
                            onClick={() => setSummaryRun(run)}
                            className="text-xs text-intents-ux-interactive-color underline underline-offset-2 hover:opacity-75"
                          >
                            {t('builder_automations_run_view_summary', undefined, 'View summary')}
                          </button>
                        )
                        : run.errorMessage
                          ? (
                            <text.span size={-2} className="text-intents-ux-critical-color truncate" title={run.errorMessage}>
                              {run.errorMessage}
                            </text.span>
                          )
                          : <text.span size={-2} emphasis="passive">—</text.span>
                      }
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block flex-1 min-h-0 overflow-y-auto">
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="border-b border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor/50">
                    <th className="px-4 py-2.5 w-1/5">
                      <text.span size={-2} emphasis="passive" className="font-semibold uppercase tracking-wider">
                        {t('builder_automations_runs_col_status', undefined, 'Status')}
                      </text.span>
                    </th>
                    <th className="px-4 py-2.5 w-1/5">
                      <text.span size={-2} emphasis="passive" className="font-semibold uppercase tracking-wider">
                        {t('builder_automations_runs_col_datetime', undefined, 'Date & Time')}
                      </text.span>
                    </th>
                    <th className="px-4 py-2.5 w-1/5">
                      <text.span size={-2} emphasis="passive" className="font-semibold uppercase tracking-wider">
                        {t('builder_automations_runs_col_duration', undefined, 'Duration')}
                      </text.span>
                    </th>
                    <th className="px-4 py-2.5 w-1/5">
                      <text.span size={-2} emphasis="passive" className="font-semibold uppercase tracking-wider">
                        {t('builder_automations_runs_col_type', undefined, 'Type')}
                      </text.span>
                    </th>
                    <th className="px-4 py-2.5 w-1/5">
                      <text.span size={-2} emphasis="passive" className="font-semibold uppercase tracking-wider">
                        {t('builder_automations_runs_col_summary', undefined, 'Summary')}
                      </text.span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-intents-ux-box-borderColor/50">
                  {pageRuns.map(run => (
                    <tr key={run.id} className="hover:bg-intents-ux-boxLowContrast-backgroundColor/40 transition-colors">
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3">
                        <text.span size={-2}>{formatDateTime(run.startedAt)}</text.span>
                      </td>
                      <td className="px-4 py-3">
                        <text.span size={-2}>{formatDuration(run.durationSeconds)}</text.span>
                      </td>
                      <td className="px-4 py-3">
                        <text.span size={-2}>
                          {run.triggeredBy === 'manual'
                            ? t('builder_automations_run_triggered_manual', undefined, 'Manual')
                            : t('builder_automations_run_triggered_scheduled', undefined, 'Scheduled')
                          }
                        </text.span>
                      </td>
                      <td className="px-4 py-3">
                        {run.status === 'success' && run.summaryRef && appId
                          ? (
                            <Button
                              type="button"
                              design="secondary"
                              size="sm"
                              onClick={() => setSummaryRun(run)}
                              text={t('builder_automations_run_view_summary', undefined, 'View summary')}
                            />
                          )
                          : run.errorMessage
                            ? (
                              <text.span size={-2} className="text-intents-ux-critical-color truncate" title={run.errorMessage}>
                                {run.errorMessage}
                              </text.span>
                            )
                            : (
                              <text.span size={-2} emphasis="passive">—</text.span>
                            )
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-intents-ux-box-borderColor/50 shrink-0">
              <text.span size={-2} emphasis="passive">
                {t('builder_automations_runs_showing', {
                  start: (page - 1) * PAGE_SIZE + 1,
                  end: Math.min(page * PAGE_SIZE, total),
                  total,
                }, `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} runs`)}
              </text.span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg text-intents-ux-neutral-color hover:bg-intents-ux-interactive-backgroundColor/30 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon className="size-3" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    disabled={loading}
                    className={cn(
                      'w-7 h-7 rounded-md transition-colors text-xs font-medium flex items-center justify-center',
                      p === page
                        ? 'bg-intents-ux-interactive-backgroundColor text-intents-ux-interactive-color font-semibold'
                        : 'text-intents-ux-neutral-color hover:bg-intents-ux-interactive-backgroundColor/30',
                    )}
                    style={undefined}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg text-intents-ux-neutral-color hover:bg-intents-ux-interactive-backgroundColor/30 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRightIcon className="size-3" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Summary modal */}
      {summaryRun && appId && (
        <SummaryModal
          run={summaryRun}
          appId={appId}
          onClose={() => setSummaryRun(null)}
        />
      )}
    </div>
  )
}
