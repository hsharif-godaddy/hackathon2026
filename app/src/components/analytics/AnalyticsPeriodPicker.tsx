'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CalendarIcon from '@ux/icon/calendar'
import text from '@ux/text'

import {
  SegmentedController,
  SegmentedControllerItem,
} from '@/components/ui/SegmentedController'
import { useTranslations } from '@/hooks/useTranslations'
import type { AnalyticsDateSelection } from '@/lib/insights/clickhouse-queries'

export type AnalyticsPeriodPreset = '7' | '15' | '30' | 'custom'

export interface AnalyticsPeriodValue {
  preset: AnalyticsPeriodPreset
  customFromDate: string
  customToDate: string
}

function isoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function defaultCustomDateRange(): { fromDate: string; toDate: string } {
  const to = new Date()
  const from = new Date()
  from.setUTCDate(from.getUTCDate() - 29)
  return { fromDate: isoDateUtc(from), toDate: isoDateUtc(to) }
}

export function defaultAnalyticsPeriodValue(): AnalyticsPeriodValue {
  const { fromDate, toDate } = defaultCustomDateRange()
  return { preset: '7', customFromDate: fromDate, customToDate: toDate }
}

export function toAnalyticsDateSelection(value: AnalyticsPeriodValue): AnalyticsDateSelection {
  if (value.preset === 'custom') {
    return { mode: 'custom', fromDate: value.customFromDate, toDate: value.customToDate }
  }
  return { mode: 'rolling', days: Number(value.preset) }
}

interface AnalyticsPeriodPickerProps {
  value: AnalyticsPeriodValue
  onChange: (value: AnalyticsPeriodValue) => void
  /** Last 15 days is a Professional+ feature */
  showLast15Days?: boolean
}

const dateInputClass =
  'w-full min-w-0 rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-1.5 text-sm text-intents-ux-box-foregroundColor'

export function AnalyticsPeriodPicker({ value, onChange, showLast15Days = false }: AnalyticsPeriodPickerProps) {
  const t = useTranslations()
  const todayIso = useMemo(() => isoDateUtc(new Date()), [])
  const [segmentValue, setSegmentValue] = useState<AnalyticsPeriodPreset>(value.preset)
  const [customOpen, setCustomOpen] = useState(value.preset === 'custom')
  const [draftFrom, setDraftFrom] = useState(value.customFromDate)
  const [draftTo, setDraftTo] = useState(value.customToDate)

  useEffect(() => {
    setSegmentValue(value.preset)
    setDraftFrom(value.customFromDate)
    setDraftTo(value.customToDate)
    setCustomOpen(value.preset === 'custom')
  }, [value.preset, value.customFromDate, value.customToDate])

  const canApply = Boolean(draftFrom && draftTo && draftFrom <= draftTo)

  const handlePresetChange = useCallback((preset: string) => {
    const next = preset as AnalyticsPeriodPreset
    setSegmentValue(next)

    if (next === 'custom') {
      setCustomOpen(true)
      if (value.preset !== 'custom') {
        const { fromDate, toDate } = defaultCustomDateRange()
        setDraftFrom(fromDate)
        setDraftTo(toDate)
      }
      return
    }

    setCustomOpen(false)
    onChange({
      preset: next,
      customFromDate: value.customFromDate,
      customToDate: value.customToDate,
    })
  }, [onChange, value])

  const handleApply = useCallback(() => {
    if (!canApply) return
    onChange({
      preset: 'custom',
      customFromDate: draftFrom,
      customToDate: draftTo,
    })
  }, [canApply, draftFrom, draftTo, onChange])

  return (
    <Box orientation="vertical" gap="sm" className="items-end w-full max-w-full">
      <SegmentedController
        radiogroupProps={{ 'aria-label': t('builder_analytics_select_period') }}
        value={segmentValue}
        onSelectionChange={handlePresetChange}
        className="shrink-0 max-w-full"
      >
        <SegmentedControllerItem value="7">{t('builder_analytics_last_7_days')}</SegmentedControllerItem>
        {showLast15Days && (
          <SegmentedControllerItem value="15">{t('builder_analytics_last_15_days')}</SegmentedControllerItem>
        )}
        <SegmentedControllerItem value="30">{t('builder_analytics_last_30_days')}</SegmentedControllerItem>
        <SegmentedControllerItem value="custom">
          <CalendarIcon width={14} height={14} />
          {t('builder_analytics_period_custom')}
        </SegmentedControllerItem>
      </SegmentedController>

      {customOpen && segmentValue === 'custom' && (
        <Box
          orientation="vertical"
          gap="sm"
          className="w-full min-w-[280px] max-w-[400px] rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-3 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <text.span size={-1} emphasis="passive">{t('builder_analytics_period_from')}</text.span>
              <input
                type="date"
                id="analytics-from-date"
                className={dateInputClass}
                value={draftFrom}
                max={draftTo || todayIso}
                onChange={(e) => {
                  const fromDate = e.target.value
                  setDraftFrom(fromDate)
                  if (draftTo && fromDate > draftTo) setDraftTo(fromDate)
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <text.span size={-1} emphasis="passive">{t('builder_analytics_period_to')}</text.span>
              <input
                type="date"
                id="analytics-to-date"
                className={dateInputClass}
                value={draftTo}
                min={draftFrom}
                max={todayIso}
                onChange={(e) => setDraftTo(e.target.value)}
              />
            </label>
          </div>
          <text.p size={-2} emphasis="passive">
            {t('builder_analytics_period_custom_hint')}
          </text.p>
          <Button
            design="primary"
            size="sm"
            text={t('builder_analytics_period_apply')}
            disabled={!canApply}
            onClick={handleApply}
          />
        </Box>
      )}
    </Box>
  )
}
