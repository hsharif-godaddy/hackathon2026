import type { useIntl } from 'react-intl'

export function formatCampaignDate(intl: ReturnType<typeof useIntl>, dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  return intl.formatDate(date, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
