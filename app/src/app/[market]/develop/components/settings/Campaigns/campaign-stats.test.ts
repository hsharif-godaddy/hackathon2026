import { describe, expect, it } from 'vitest'

import { parseCampaignStatsBatch, type RawCampaignStat, topLeadSourceShare } from './campaign-stats'
import { formatLeadMedium, formatLeadSource } from './copy'

describe('parseCampaignStatsBatch', function batchTests() {
  const sample: RawCampaignStat[] = [
    {
      id: 'cmp_01HWKXTEST00000CAMPAGN0001',
      totals: { leads: 5821 },
      breakdown: [{ key: { source: 'BLOG_AAB', medium: 'BLOG' }, metrics: { leads: 4100 } }],
    },
    {
      id: 'cmp_01HWKXTEST00000CAMPAGN0002',
      totals: { leads: 892 },
      breakdown: [{ key: { source: 'FACEBOOK', medium: 'ORGANIC_SOCIAL' }, metrics: { leads: 892 } }],
    },
  ]

  it('keys normalized stats by campaign ref', function keyByRef() {
    const byRef = parseCampaignStatsBatch(sample)
    expect(Object.keys(byRef)).toEqual([
      'cmp_01HWKXTEST00000CAMPAGN0001',
      'cmp_01HWKXTEST00000CAMPAGN0002',
    ])
    expect(byRef['cmp_01HWKXTEST00000CAMPAGN0001'].totalLeads).toBe(5821)
    expect(byRef['cmp_01HWKXTEST00000CAMPAGN0002'].breakdown).toEqual([
      { source: 'FACEBOOK', medium: 'ORGANIC_SOCIAL', leads: 892 },
    ])
  })

  it('skips entries without an id and returns an empty map for no campaigns', function skipsAndEmpty() {
    expect(parseCampaignStatsBatch([{ totals: { leads: 5 } }])).toEqual({})
    expect(parseCampaignStatsBatch([])).toEqual({})
  })
})

describe('topLeadSourceShare', function shareTests() {
  it('returns the top source and rounded percentage from the API sample', function topShare() {
    const stats = {
      totalLeads: 685,
      breakdown: [
        { source: 'FACEBOOK', medium: 'ORGANIC_SOCIAL', leads: 312 },
        { source: 'INSTAGRAM', medium: 'ORGANIC_SOCIAL', leads: 278 },
        { source: 'BLOG_AAB', medium: 'BLOG', leads: 95 },
      ],
    }
    expect(topLeadSourceShare(stats)).toEqual({ source: 'FACEBOOK', percent: 46 })
  })

  it('sums leads across mediums for the same source before ranking', function aggregatesBySource() {
    const stats = {
      totalLeads: 300,
      breakdown: [
        { source: 'INSTAGRAM', medium: 'ORGANIC_SOCIAL', leads: 100 },
        { source: 'INSTAGRAM', medium: 'PAID_SOCIAL', leads: 110 },
        { source: 'FACEBOOK', medium: 'ORGANIC_SOCIAL', leads: 90 },
      ],
    }
    expect(topLeadSourceShare(stats)).toEqual({ source: 'INSTAGRAM', percent: 70 })
  })

  it('returns null when there are no leads to attribute', function noLeads() {
    expect(topLeadSourceShare({ totalLeads: 0, breakdown: [] })).toBeNull()
    expect(topLeadSourceShare({ totalLeads: 50, breakdown: [] })).toBeNull()
  })
})

describe('lead label formatters', function labelTests() {
  it('maps known source enums to friendly labels', function knownSource() {
    expect(formatLeadSource('BLOG_AAB')).toBe('Blog')
    expect(formatLeadSource('FACEBOOK')).toBe('Facebook')
    expect(formatLeadSource('INSTAGRAM')).toBe('Instagram')
  })

  it('humanizes unknown source enums and handles empty values', function unknownSource() {
    expect(formatLeadSource('GOOGLE_ADS')).toBe('Google Ads')
    expect(formatLeadSource('')).toBe('')
  })

  it('maps and humanizes medium enums', function mediums() {
    expect(formatLeadMedium('ORGANIC_SOCIAL')).toBe('Organic Social')
    expect(formatLeadMedium('PAID_SEARCH')).toBe('Paid Search')
    expect(formatLeadMedium('')).toBe('')
  })
})
