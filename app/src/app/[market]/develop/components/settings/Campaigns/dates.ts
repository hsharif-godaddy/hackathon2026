import type { useIntl } from 'react-intl'

import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { useTranslations } from '@/hooks/useTranslations'

type Translate = ReturnType<typeof useTranslations>

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

export function formatCampaignDate(intl: ReturnType<typeof useIntl>, dateStr: string): string {
  if (!dateStr) return ''
  const date: Date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''

  const day: number = date.getUTCDate()
  const month: string = intl.formatDate(date, { month: 'long', timeZone: 'UTC' })
  if (intl.locale.startsWith('en')) {
    return `${month} ${day}${getOrdinalSuffix(day)}`
  }

  return intl.formatDate(date, { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function formatCampaignScheduleRange(
  intl: ReturnType<typeof useIntl>,
  t: Translate,
  startDate: string,
  endDate: string,
): string {
  const start: string = formatCampaignDate(intl, startDate)
  const end: string = formatCampaignDate(intl, endDate)
  if (!start && !end) return ''
  if (!end) return start
  if (!start) return end
  return translateCampaignKey(t, CAMPAIGN_KEYS.dateRange, { start, end })
}

export function formatAssetDateTime(
  intl: ReturnType<typeof useIntl>,
  t: Translate,
  dateStr?: string,
): string {
  if (!dateStr) return ''
  const date: Date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const datePart: string = intl.formatDate(date, { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const timePart: string = intl.formatDate(date, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  return translateCampaignKey(t, CAMPAIGN_KEYS.dateAt, { date: datePart, time: timePart })
}
