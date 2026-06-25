'use client'

import { useId, useRef, useState } from 'react'
import Button from '@ux/button'
import ClockIcon from '@ux/icon/clock'
import EditIcon from '@ux/icon/edit'
import PlayIcon from '@ux/icon/play'
import PlusIcon from '@ux/icon/plus'
import SparklesIcon from '@ux/icon/sparkles'
import TrashIcon from '@ux/icon/trash'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

import { Automation } from '@/app/[market]/develop/components/automations/types'
import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'

export interface AutomationCardProps {
  automation: Automation
  onRun: (automation: Automation) => void
  onEdit?: (automation: Automation) => void
  onDelete?: (automation: Automation) => void
  onAdd?: (automation: Automation) => void
  isRunning: boolean
  isAdding?: boolean
  added?: boolean
}

export default function AutomationCard({ automation, onRun, onEdit, onDelete, onAdd, isRunning, isAdding = false, added }: AutomationCardProps) {
  const t = useTranslations()
  const runButtonRef = useRef<HTMLSpanElement>(null)
  const [showRunTooltip, setShowRunTooltip] = useState(false)
  const runTooltipId = useId()
  const addButtonRef = useRef<HTMLSpanElement>(null)
  const [showAddTooltip, setShowAddTooltip] = useState(false)
  const addTooltipId = useId()
  const scheduleButtonRef = useRef<HTMLButtonElement>(null)
  const [showScheduleTooltip, setShowScheduleTooltip] = useState(false)
  const scheduleTooltipId = useId()

  return (
    <>
    <div
      data-testid={`automation-card-${automation.id}`}
      className={cn(
        'group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-xl border cursor-pointer',
        'bg-intents-ux-box-backgroundColor border-intents-ux-box-borderColor',
        'hover:border-intents-ux-interactive-borderColor hover:shadow-md transition-all duration-200',
        'hover:-translate-y-px',
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
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap sm:flex-nowrap sm:shrink-0">
        {onEdit && (
          <Button
            type="button"
            design="stateless"
            size="sm"
            onClick={() => onEdit(automation)}
            className="cursor-pointer p-1.5 rounded-lg text-intents-ux-neutral-color hover:text-intents-ux-interactive-color hover:bg-intents-ux-interactive-backgroundColor transition-colors sm:opacity-0 sm:group-hover:opacity-100"
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
            className="cursor-pointer p-1.5 rounded-lg text-intents-ux-neutral-color hover:text-intents-ux-critical-color hover:bg-intents-ux-critical-backgroundColor transition-colors sm:opacity-0 sm:group-hover:opacity-100"
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
          onMouseEnter={() => setShowScheduleTooltip(true)}
          onMouseLeave={() => setShowScheduleTooltip(false)}
          aria-describedby={showScheduleTooltip ? scheduleTooltipId : undefined}
          className="cursor-not-allowed"
        >
          <Button
            type="button"
            design="secondary"
            size="sm"
            disabled
            className="pointer-events-none"
            aria-label={`Schedule ${automation.name}`}
            icon={<ClockIcon />}
            text={t('builder_automations_card_scheduler', undefined, 'Schedule')}
          />
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
    {showScheduleTooltip && (
      <Tooltip id={scheduleTooltipId} anchorRef={scheduleButtonRef} portalElem={document.body}>
        <div className="p-1 text-start max-w-[25ch] break-words">
          {t('builder_automations_schedule_coming_soon', undefined, 'Coming soon')}
        </div>
      </Tooltip>
    )}
    </>
  )
}
