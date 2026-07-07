'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Button from '@ux/button'
import AlertIcon from '@ux/icon/alert'
import CheckmarkIcon from '@ux/icon/checkmark'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronRightIcon from '@ux/icon/chevron-right'
import ChevronUpIcon from '@ux/icon/chevron-up'
import ClockIcon from '@ux/icon/clock'
import EditIcon from '@ux/icon/edit'
import PlayIcon from '@ux/icon/play'
import PlusIcon from '@ux/icon/plus'
import SparklesIcon from '@ux/icon/sparkles'
import TrashIcon from '@ux/icon/trash'
import CloseIcon from '@ux/icon/x'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

import {
  cronExprToScheduleConfig,
  formatScheduleSummary,
} from '@/app/[market]/develop/components/automations/AutomationScheduleModal'
import type { AutomationSchedule } from '@/app/[market]/develop/components/automations/types'
import { Automation } from '@/app/[market]/develop/components/automations/types'
import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import { type AutomationRun, type AutomationRunStatus, PREVIEW_RUNS_LIMIT,useAutomationRuns } from '@/hooks/useAutomationRuns'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'

export interface AutomationCardProps {
  appId: string | null
  automation: Automation
  onRun: (automation: Automation) => void
  onSchedule?: (automation: Automation) => void
  onEdit?: (automation: Automation) => void
  onDelete?: (automation: Automation) => void
  onAdd?: (automation: Automation) => void
  onViewAllRuns?: (automation: Automation) => void
  isRunning: boolean
  isAdding?: boolean
  added?: boolean
  schedulingEnabled?: boolean
  /** True when the scheduling feature flag is off — shows "Coming soon" tooltip instead of publish prompt. */
  schedulingComingSoon?: boolean
  /** Live schedule data from airo-go */
  activeSchedule?: AutomationSchedule
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds?: number): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function formatStarted(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRunStatus(
  status: AutomationRunStatus,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (status) {
    case 'success':
      return t('builder_automations_run_status_success', undefined, 'Succeeded')
    case 'partial':
      return t('builder_automations_run_status_partial', undefined, 'Partial')
    case 'running':
      return t('builder_automations_run_status_running', undefined, 'Running')
    case 'pending':
      return t('builder_automations_run_status_pending', undefined, 'Pending')
    case 'cancelled':
      return t('builder_automations_run_status_cancelled', undefined, 'Cancelled')
    default:
      return t('builder_automations_run_status_failed', undefined, 'Failed')
  }
}

function RunStatusIcon({ status }: { status: AutomationRunStatus }) {
  if (status === 'success') {
    return <CheckmarkIcon className="size-2.5 shrink-0 text-intents-ux-positive-color" />
  }
  if (status === 'partial') {
    return <AlertIcon className="size-2.5 shrink-0 text-intents-ux-warning-color" />
  }
  if (status === 'running' || status === 'pending') {
    return <SpinnerIcon className="size-2.5 shrink-0" />
  }
  if (status === 'cancelled') {
    return <CloseIcon className="size-2.5 shrink-0 text-intents-ux-neutral-color" />
  }
  return <AlertIcon className="size-2.5 shrink-0 text-intents-ux-critical-color" />
}

// ─── Shared run row ─────────────────────────────────────────────────────────

export interface RunRowProps {
  run: AutomationRun
}

export function RunRow({ run }: RunRowProps) {
  const t = useTranslations()
  const statusLabel = formatRunStatus(run.status, t)
  const triggeredLabel = run.triggeredBy === 'manual'
    ? t('builder_automations_run_triggered_manual', undefined, 'Manual')
    : t('builder_automations_run_triggered_scheduled', undefined, 'Scheduled')
  return (
    <li className="flex items-center gap-3 px-3 py-2 min-w-0">
      <RunStatusIcon status={run.status} />
      <text.span size={-2} className="font-medium shrink-0 w-16">{statusLabel}</text.span>
      <text.span size={-2} emphasis="passive" className="shrink-0 w-32">
        {formatStarted(run.startedAt)}
      </text.span>
      <text.span size={-2} emphasis="passive" className="shrink-0 w-12">
        {formatDuration(run.durationSeconds)}
      </text.span>
      <text.span size={-2} emphasis="passive" className="shrink-0 hidden sm:inline w-16">
        {triggeredLabel}
      </text.span>
      {run.errorMessage && (
        <text.span
          size={-2}
          className="text-intents-ux-critical-color truncate min-w-0 flex-1"
          title={run.errorMessage}
        >
          {run.errorMessage}
        </text.span>
      )}
    </li>
  )
}

// ─── Runs accordion ─────────────────────────────────────────────────────────

interface RunsAccordionProps {
  appId: string | null
  hostedAutomationId: string
  onViewAll: () => void
}

function RunsAccordion({ appId, hostedAutomationId, onViewAll }: RunsAccordionProps) {
  const t = useTranslations()
  const { runs, loading, fetched, fetch: fetchRuns } = useAutomationRuns(appId, hostedAutomationId)

  useEffect(() => {
    void fetchRuns({ limit: PREVIEW_RUNS_LIMIT })
  }, [])

  if (!fetched && loading) {
    return (
      <div className="flex items-center gap-1 px-3 py-1.5 text-intents-ux-neutral-color">
        <SpinnerIcon className="size-2.5" />
        <text.span size={-2} emphasis="passive">
          {t('builder_automations_runs_loading', undefined, 'Loading…')}
        </text.span>
      </div>
    )
  }

  if (fetched && runs.length === 0) {
    return (
      <div className="px-3 py-1.5">
        <text.p size={-2} emphasis="passive">
          {t('builder_automations_runs_empty', undefined, 'No runs yet.')}
        </text.p>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-y divide-intents-ux-box-borderColor/50">
        {runs.map(run => <RunRow key={run.id} run={run} />)}
      </ul>
      <button
        type="button"
        onClick={onViewAll}
        className="flex w-full items-center justify-between gap-1 px-3 py-1.5 border-t border-intents-ux-box-borderColor/50 text-intents-ux-interactive-color hover:bg-intents-ux-interactive-backgroundColor/30 transition-colors"
      >
        <text.span size={-2} className="font-medium">
          {t('builder_automations_view_all_runs', undefined, 'View all runs')}
        </text.span>
        <ChevronRightIcon className="size-2.5 shrink-0" />
      </button>
    </>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function AutomationCard({
  appId,
  automation,
  onRun,
  onSchedule,
  onEdit,
  onDelete,
  onAdd,
  onViewAllRuns,
  isRunning,
  isAdding = false,
  added,
  schedulingEnabled = false,
  schedulingComingSoon = false,
  activeSchedule,
}: AutomationCardProps) {
  const t = useTranslations()
  const runButtonRef = useRef<HTMLSpanElement>(null)
  const [showRunTooltip, setShowRunTooltip] = useState(false)
  const runTooltipId = useId()
  const addButtonRef = useRef<HTMLSpanElement>(null)
  const [showAddTooltip, setShowAddTooltip] = useState(false)
  const addTooltipId = useId()
  const scheduleButtonRef = useRef<HTMLSpanElement>(null)
  const [showScheduleTooltip, setShowScheduleTooltip] = useState(false)
  const scheduleTooltipId = useId()
  const [expanded, setExpanded] = useState(false)

  const isScheduled = !!activeSchedule?.enabled && activeSchedule?.triggerType === 'cron'
  const scheduleSummary = activeSchedule?.cronExpr && activeSchedule?.triggerType === 'cron'
    ? (() => {
        const cfg = cronExprToScheduleConfig(activeSchedule.cronExpr)
        return cfg ? formatScheduleSummary(cfg.frequency, cfg.day, cfg.time) : null
      })()
    : null

  // Allow expand whenever there is a hosted automation id (scheduled or manual registration)
  const hostedId = activeSchedule?.id

  function handleToggle() {
    setExpanded(prev => !prev)
  }

  return (
    <>
    <div
      data-testid={`automation-card-${automation.id}`}
      className={cn(
        'flex flex-col rounded-xl border overflow-hidden',
        'bg-intents-ux-box-backgroundColor border-intents-ux-box-borderColor',
        'transition-all duration-200',
      )}
    >
      {/* Main row */}
      <div
        className={cn(
          'group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3',
          !expanded && 'hover:-translate-y-px hover:shadow-md',
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="shrink-0 p-1.5 rounded-lg bg-intents-ux-actionPrimary-backgroundColor/20 border border-intents-ux-actionPrimary-borderColor/20">
            <SparklesIcon className="size-2.5 text-intents-ux-actionPrimary-backgroundColor" />
          </div>
          <div className="flex-1 min-w-0">
            <text.p size={-1} className="font-semibold leading-tight truncate">
              {automation.name}
            </text.p>
            <text.p size={-2} emphasis="passive" className="mt-0.5 truncate">
              {automation.description}
            </text.p>
            {scheduleSummary && (
              <div className="mt-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-text-minorColor">
                  <ClockIcon className="size-2.5 shrink-0" />
                  <text.span size={-2} className="truncate">
                    {scheduleSummary}
                  </text.span>
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:flex-nowrap sm:shrink-0">
          {onEdit && (
            <Button
              type="button"
              design="stateless"
              size="sm"
              onClick={() => onEdit(automation)}
              className="hidden sm:inline-flex cursor-pointer p-1.5 rounded-lg text-intents-ux-neutral-color hover:text-intents-ux-interactive-color hover:bg-intents-ux-interactive-backgroundColor transition-colors sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={`Edit ${automation.name}`}
              icon={<EditIcon />}
            />
          )}
          {onDelete && (
            <Button
              type="button"
              design="stateless"
              size="sm"
              onClick={() => onDelete(automation)}
              className="hidden sm:inline-flex cursor-pointer p-1.5 rounded-lg text-intents-ux-neutral-color hover:text-intents-ux-critical-color hover:bg-intents-ux-critical-backgroundColor transition-colors sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={`Delete ${automation.name}`}
              icon={<TrashIcon />}
            />
          )}
          {onAdd && !added && (
            <span
              ref={addButtonRef}
              onMouseEnter={() => isRunning && setShowAddTooltip(true)}
              onMouseLeave={() => setShowAddTooltip(false)}
              aria-describedby={showAddTooltip ? addTooltipId : undefined}
              className={isRunning ? 'cursor-not-allowed' : undefined}
            >
              <Button
                type="button"
                design="secondary"
                size="sm"
                onClick={isRunning ? undefined : () => onAdd(automation)}
                disabled={isAdding || isRunning}
                aria-label={`Add ${automation.name} to your automations`}
                className={isRunning ? 'pointer-events-none' : undefined}
                icon={isAdding ? <SpinnerIcon /> : <PlusIcon />}
                text={t('builder_automations_card_add', undefined, 'Add')}
              />
            </span>
          )}
          {added && (
            <span className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-intents-ux-neutral-color">
              {t('builder_automations_template_added', undefined, 'Added')}
            </span>
          )}
          <span
            ref={scheduleButtonRef}
            onMouseEnter={() => !schedulingEnabled && setShowScheduleTooltip(true)}
            onMouseLeave={() => setShowScheduleTooltip(false)}
            aria-describedby={showScheduleTooltip ? scheduleTooltipId : undefined}
            className={cn('inline-flex', schedulingEnabled ? undefined : 'cursor-not-allowed')}
          >
            <span className="sm:hidden">
              <Button
                type="button"
                design="secondary"
                size="sm"
                disabled={!schedulingEnabled}
                onClick={schedulingEnabled ? () => onSchedule?.(automation) : undefined}
                className={cn(
                  schedulingEnabled ? undefined : 'pointer-events-none',
                  isScheduled && 'border-intents-ux-interactive-borderColor text-intents-ux-interactive-color',
                )}
                aria-label={`Schedule ${automation.name}`}
                icon={<ClockIcon />}
              />
            </span>
            <span className="hidden sm:inline-flex">
              <Button
                type="button"
                design="secondary"
                size="sm"
                disabled={!schedulingEnabled}
                onClick={schedulingEnabled ? () => onSchedule?.(automation) : undefined}
                className={cn(
                  schedulingEnabled ? undefined : 'pointer-events-none',
                  isScheduled && 'border-intents-ux-interactive-borderColor text-intents-ux-interactive-color',
                )}
                aria-label={`Schedule ${automation.name}`}
                icon={<ClockIcon />}
                text={isScheduled
                  ? t('builder_automations_card_update_schedule', undefined, 'Scheduled')
                  : t('builder_automations_card_scheduler', undefined, 'Schedule')
                }
              />
            </span>
          </span>
          <span
            ref={runButtonRef}
            onMouseEnter={() => isRunning && setShowRunTooltip(true)}
            onMouseLeave={() => setShowRunTooltip(false)}
            onClick={isRunning ? () => onRun(automation) : undefined}
            className={isRunning ? 'cursor-not-allowed' : undefined}
            aria-describedby={showRunTooltip ? runTooltipId : undefined}
            data-testid="automation-run-button-wrapper"
          >
            <Button
              type="button"
              design="primary"
              size="sm"
              onClick={isRunning ? undefined : () => onRun(automation)}
              disabled={isRunning}
              data-testid="automation-run-button"
              className={isRunning ? 'pointer-events-none' : undefined}
              aria-label={`Run ${automation.name}`}
              icon={<PlayIcon />}
              text={t('builder_automations_card_run', undefined, 'Run')}
            />
          </span>
        </div>
      </div>

      {/* Bottom runs accordion — small toggle bar */}
      {hostedId && (
        <>
          <button
            type="button"
            onClick={handleToggle}
            aria-label={expanded ? 'Collapse runs' : 'Expand runs'}
            aria-expanded={expanded}
            className={cn(
              'flex w-full items-center justify-between gap-2 px-3 py-1.5',
              'border-t border-intents-ux-box-borderColor',
              'bg-intents-ux-boxLowContrast-backgroundColor/50',
              'text-intents-ux-neutral-color hover:text-intents-ux-color transition-colors',
            )}
          >
            <text.span size={-2} emphasis="passive" className="font-medium">
              {t('builder_automations_recent_runs', undefined, 'Recent runs')}
            </text.span>
            {expanded
              ? <ChevronUpIcon className="size-2.5 shrink-0" />
              : <ChevronDownIcon className="size-2.5 shrink-0" />
            }
          </button>
          {expanded && (
            <RunsAccordion
              appId={appId}
              hostedAutomationId={hostedId}
              onViewAll={() => onViewAllRuns?.(automation)}
            />
          )}
        </>
      )}
    </div>

    {showRunTooltip && isRunning && (
      <Tooltip id={runTooltipId} anchorRef={runButtonRef} portalElem={document.body}>
        <div className="p-1 text-start max-w-[25ch] break-words">
          {t('builder_automations_agent_busy_tooltip', undefined, 'Agent is processing')}
        </div>
      </Tooltip>
    )}
    {showAddTooltip && isRunning && (
      <Tooltip id={addTooltipId} anchorRef={addButtonRef} portalElem={document.body}>
        <div className="p-1 text-start max-w-[25ch] break-words">
          {t('builder_automations_agent_busy_tooltip', undefined, 'Agent is processing')}
        </div>
      </Tooltip>
    )}
    {showScheduleTooltip && !schedulingEnabled && (
      <Tooltip id={scheduleTooltipId} anchorRef={scheduleButtonRef} portalElem={document.body}>
        <div className="p-1 text-start max-w-[25ch] break-words">
          {schedulingComingSoon
            ? t('builder_automations_schedule_coming_soon', undefined, 'Coming soon')
            : t('builder_automations_schedule_publish_required', undefined, 'Publish your app to schedule automations')}
        </div>
      </Tooltip>
    )}
    </>
  )
}
