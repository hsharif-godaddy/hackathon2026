/**
 * @vitest-environment jsdom
 */
import { createIntl, createIntlCache } from 'react-intl'
import { describe, expect, it } from 'vitest'

import { formatCampaignDate } from './dates'

const intl = createIntl({ locale: 'en-US', messages: {} }, createIntlCache())

describe('formatCampaignDate', function dateTests() {
  it('formats date-only strings in UTC so calendar day is preserved', function utcDay() {
    expect(formatCampaignDate(intl, '2026-06-15')).toBe('Jun 15')
  })

  it('returns empty string for missing or invalid dates', function invalid() {
    expect(formatCampaignDate(intl, '')).toBe('')
    expect(formatCampaignDate(intl, 'not-a-date')).toBe('')
  })
})
