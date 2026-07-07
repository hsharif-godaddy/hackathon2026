'use client'

import { useEffect, useState } from 'react'
import Button from '@ux/button'
import Select from '@ux/select'
import text from '@ux/text'

import { Automation } from '@/app/[market]/develop/components/automations/types'
import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

export type AutomationFrequency = 'daily' | 'weekly'
export type AutomationDay = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface ScheduleConfig {
  frequency: AutomationFrequency
  day: AutomationDay
  /** Local time as "HH:MM" — caller converts to UTC cron expression */
  time: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEDULE_MINUTE_INTERVAL = 60

// Cron day order: index 0 = Sunday (matches cron convention)
const DAY_OPTIONS: { value: AutomationDay; label: string; title: string }[] = [
  { value: 'sun', label: 'S', title: 'Sunday' },
  { value: 'mon', label: 'M', title: 'Monday' },
  { value: 'tue', label: 'T', title: 'Tuesday' },
  { value: 'wed', label: 'W', title: 'Wednesday' },
  { value: 'thu', label: 'T', title: 'Thursday' },
  { value: 'fri', label: 'F', title: 'Friday' },
  { value: 'sat', label: 'S', title: 'Saturday' },
]

const FREQUENCY_OPTIONS: { value: AutomationFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const SCHEDULE_TIME_OPTIONS = Array.from(
  { length: (24 * 60) / SCHEDULE_MINUTE_INTERVAL },
  (_, i) => {
    const totalMinutes = i * SCHEDULE_MINUTE_INTERVAL
    const hour = Math.floor(totalMinutes / 60)
    const minute = totalMinutes % 60
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    return { value, label: formatTimeLabel(value) }
  },
)

const SEGMENT_LEFT =
  'px-2 !rounded-r-none [&[aria-checked=false]]:!bg-transparent [&[aria-checked=false]]:shadow-none'
const SEGMENT_RIGHT =
  'px-2 !rounded-l-none [&[aria-checked=false]]:!bg-transparent [&[aria-checked=false]]:shadow-none'
const SEGMENT_ACTIVE =
  '[&[aria-checked=true]]:bg-intents-ux-boxHighContrast-backgroundColor [&[aria-checked=true]]:text-intents-ux-boxHighContrast-foregroundColor [&[aria-checked=true]]:shadow-md'

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeTime(hhmm: string): string {
  const [hourRaw, minuteRaw] = hhmm.split(':').map(Number)
  if (!Number.isFinite(hourRaw)) return '09:00'
  const total = hourRaw * 60 + (Number.isFinite(minuteRaw) ? minuteRaw : 0)
  const snapped =
    Math.round(Math.min(24 * 60 - 1, Math.max(0, total)) / SCHEDULE_MINUTE_INTERVAL) *
    SCHEDULE_MINUTE_INTERVAL
  const clamped = Math.min(23 * 60, snapped)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
}

/**
 * Build a human-readable schedule summary.
 * Exported so callers can show "Every Monday at 9:00 AM" in the card.
 */
export function formatScheduleSummary(
  frequency: AutomationFrequency,
  day: AutomationDay,
  time: string,
): string {
  const timeLabel = formatTimeLabel(normalizeTime(time))
  if (frequency === 'daily') return `Every day at ${timeLabel}`
  const dayLabel = DAY_OPTIONS.find((o) => o.value === day)?.title ?? day
  return `Every ${dayLabel} at ${timeLabel}`
}

/**
 * Parse a UTC cron expression back into a local-time ScheduleConfig.
 * Handles "M H * * *" daily and "M H * * D" weekly patterns.
 */
export function cronExprToScheduleConfig(cronExpr: string): ScheduleConfig | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const utcMinute = parseInt(parts[0], 10)
  const utcHour = parseInt(parts[1], 10)
  const dayPart = parts[4]
  if (isNaN(utcHour) || isNaN(utcMinute)) return null

  const offsetMinutes = new Date().getTimezoneOffset()
  const totalUTCMinutes = utcHour * 60 + utcMinute
  const totalLocalMinutes = ((totalUTCMinutes - offsetMinutes) % 1440 + 1440) % 1440
  const localHour = Math.floor(totalLocalMinutes / 60)
  const localMinute = totalLocalMinutes % 60
  const localTime = `${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`

  if (dayPart === '*') {
    return { frequency: 'daily', day: 'mon', time: localTime }
  }

  const utcDayIndex = parseInt(dayPart, 10)
  if (isNaN(utcDayIndex)) return null

  const rawLocal = totalUTCMinutes - offsetMinutes
  const dayShift = rawLocal < 0 ? -1 : rawLocal >= 1440 ? 1 : 0
  const localDayIndex = ((utcDayIndex + dayShift) % 7 + 7) % 7
  const day = DAY_OPTIONS[localDayIndex]?.value ?? 'mon'

  return { frequency: 'weekly', day, time: localTime }
}

/**
 * Convert a local-time ScheduleConfig to a UTC cron expression.
 * Accounts for the full timezone offset including sub-hour components (e.g. IST UTC+5:30).
 * e.g. { frequency: 'daily', time: '15:00' } at UTC+5:30 → "30 9 * * *"
 */
export function scheduleToCronExpr(config: ScheduleConfig): string {
  const [localHour, localMinute = 0] = config.time.split(':').map(Number)
  const offsetMinutes = new Date().getTimezoneOffset() // negative east of UTC
  const totalLocalMinutes = localHour * 60 + localMinute
  const totalUTCMinutes = ((totalLocalMinutes + offsetMinutes) % 1440 + 1440) % 1440
  const utcHour = Math.floor(totalUTCMinutes / 60)
  const utcMinute = totalUTCMinutes % 60

  if (config.frequency === 'daily') {
    return `${utcMinute} ${utcHour} * * *`
  }

  const localDayIndex = DAY_OPTIONS.findIndex((o) => o.value === config.day)
  const rawUTC = totalLocalMinutes + offsetMinutes
  const dayShift = rawUTC < 0 ? -1 : rawUTC >= 1440 ? 1 : 0
  const utcDayIndex = ((localDayIndex + dayShift) % 7 + 7) % 7
  return `${utcMinute} ${utcHour} * * ${utcDayIndex}`
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AutomationScheduleModalProps {
  isOpen: boolean
  automation: Automation
  /** Pre-fill if the automation already has a schedule */
  initialSchedule?: Partial<ScheduleConfig>
  /** True when the automation already has a saved schedule (shows Remove button) */
  hasExistingSchedule?: boolean
  saving: boolean
  onSave: (config: ScheduleConfig) => Promise<void>
  /** Called when the user wants to remove the existing schedule */
  onRemoveSchedule?: () => void
  onClose: () => void
}

const DEFAULT_SCHEDULE: ScheduleConfig = { frequency: 'weekly', day: 'mon', time: '09:00' }

export default function AutomationScheduleModal({
  isOpen,
  automation,
  initialSchedule,
  hasExistingSchedule = false,
  saving,
  onSave,
  onRemoveSchedule,
  onClose,
}: AutomationScheduleModalProps) {
  const t = useTranslations()
  const [draft, setDraft] = useState<ScheduleConfig>({ ...DEFAULT_SCHEDULE, ...initialSchedule })

  // Reset draft to initial values whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setDraft({ ...DEFAULT_SCHEDULE, ...initialSchedule })
    }
   
  }, [isOpen])

  const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function handleSave() {
    await onSave({ ...draft, time: normalizeTime(draft.time) })
    onClose()
  }

  return (
    <ToolModal
      isOpen={isOpen}
      onClose={onClose}
      title={hasExistingSchedule
        ? t('builder_automations_schedule_modal_title_update', undefined, 'Update schedule')
        : t('builder_automations_schedule_modal_title', undefined, 'Schedule automation')
      }
    >
      <div className="flex min-w-[17rem] flex-col gap-4 p-3 sm:min-w-[20rem]">
        {/* Automation name context */}
        <text.p size={-1} className="text-intents-ux-text-minorColor">
          {automation.name}
        </text.p>

        {/* Frequency: Daily / Weekly */}
        <div className="flex flex-col gap-2">
          <text.span size={-1} className="font-medium text-intents-ux-box-foregroundColor">
            {t('builder_automations_schedule_modal_repeat', undefined, 'Repeat')}
          </text.span>
          <ButtonGroup
            value={draft.frequency}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, frequency: value as AutomationFrequency }))
            }
            className="w-fit !gap-0"
          >
            {FREQUENCY_OPTIONS.map((opt, i) => (
              <ButtonGroup.Item
                key={opt.value}
                value={opt.value}
                label={opt.label}
                showLabelAlways
                disabled={saving}
                className={cn(i === 0 ? SEGMENT_LEFT : SEGMENT_RIGHT, SEGMENT_ACTIVE)}
              />
            ))}
          </ButtonGroup>
        </div>

        {/* Day picker — animated in/out */}
        <div
          className={cn(
            'grid transition-all duration-150',
            draft.frequency === 'weekly' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="flex flex-col gap-2 overflow-hidden">
            <text.span size={-1} className="font-medium text-intents-ux-box-foregroundColor">
              {t('builder_automations_schedule_modal_on', undefined, 'On')}
            </text.span>
            <div className="flex flex-wrap gap-1.5">
              {DAY_OPTIONS.map((opt) => {
                const selected = draft.day === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.title}
                    disabled={saving || draft.frequency !== 'weekly'}
                    aria-pressed={selected}
                    onClick={() => setDraft((prev) => ({ ...prev, day: opt.value }))}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                      selected
                        ? 'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor'
                        : 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-box-foregroundColor hover:bg-intents-ux-boxLowContrast-backgroundColor/80',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Time picker */}
        <Select
          id="automation-schedule-time"
          name="automation-schedule-time"
          label={t('builder_automations_schedule_modal_time', undefined, 'Time')}
          visualSize="sm"
          value={normalizeTime(draft.time)}
          onChange={(value: string) => setDraft((prev) => ({ ...prev, time: value }))}
          disabled={saving}
        >
          {SCHEDULE_TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        {/* Timezone note */}
        <text.p size={-1} className="text-intents-ux-text-minorColor">
          {t(
            'builder_automations_schedule_modal_timezone',
            { timezoneLabel },
            `Times are in your local timezone (${timezoneLabel}).`,
          )}
        </text.p>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-intents-ux-boxLowContrast-borderColor pt-3">
          {hasExistingSchedule && onRemoveSchedule && (
            <Button
              design="secondary"
              size="small"
              disabled={saving}
              onClick={onRemoveSchedule}
              className="text-intents-ux-critical-color border-intents-ux-critical-borderColor hover:bg-intents-ux-critical-backgroundColor mr-auto"
            >
              {t('builder_automations_schedule_modal_remove', undefined, 'Remove schedule')}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button design="secondary" size="small" disabled={saving} onClick={onClose}>
              {t('builder_common_cancel', undefined, 'Cancel')}
            </Button>
            <Button
              design="primary"
              size="small"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving
                ? t('builder_automations_schedule_modal_saving', undefined, 'Saving...')
                : hasExistingSchedule
                  ? t('builder_automations_schedule_modal_update', undefined, 'Update schedule')
                  : t('builder_automations_schedule_modal_save', undefined, 'Save schedule')
              }
            </Button>
          </div>
        </div>
      </div>
    </ToolModal>
  )
}
