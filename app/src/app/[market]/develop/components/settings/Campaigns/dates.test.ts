/**
 * @vitest-environment jsdom
 */
import { createIntl, createIntlCache } from 'react-intl'
import { describe, expect, it } from 'vitest'

import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { formatCampaignDate, formatCampaignScheduleRange } from './dates'

const intl = createIntl({ locale: 'en-US', messages: {} }, createIntlCache())

function t(key: string, values?: Record<string, unknown>): string {
  const template = CAMPAIGN_DEFAULT_MESSAGES[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ''))
}

describe('formatCampaignDate', function dateTests() {
  it('formats date-only strings in UTC with ordinal suffixes for English', function utcDay() {
    expect(formatCampaignDate(intl, '2026-06-15')).toBe('June 15th')
  })

  it('returns empty string for missing or invalid dates', function invalid() {
    expect(formatCampaignDate(intl, '')).toBe('')
    expect(formatCampaignDate(intl, 'not-a-date')).toBe('')
  })
})

describe('formatCampaignScheduleRange', function rangeTests() {
  it('joins start and end with ICU date_range key', function range() {
    expect(formatCampaignScheduleRange(intl, t, '2026-07-17', '2026-08-02')).toBe('July 17th to August 2nd')
  })

  it('returns only start when end is missing', function startOnly() {
    expect(formatCampaignScheduleRange(intl, t, '2026-07-17', '')).toBe('July 17th')
  })

  it('returns empty string when both dates are missing', function bothMissing() {
    expect(formatCampaignScheduleRange(intl, t, '', '')).toBe('')
  })
})
