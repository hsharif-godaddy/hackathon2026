import { afterEach,describe, expect,it, vi } from 'vitest'

import { socialV2Client, toGbpPostalAddress, toGbpRegularHours } from './social'

interface CapturedCall {
  method: string
  body: Record<string, unknown> | null
}

/** Mock fetch: a non-PATCH call returns `readBody` (the pre-read); PATCH returns {}. */
function mockGbpFetch(readBody: Record<string, unknown>): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, body: init?.body ? JSON.parse(init.body) : null })
      const payload = method === 'PATCH' ? {} : readBody
      return new Response(JSON.stringify(payload), { status: 200 })
    }),
  )
  return { calls }
}

function patchedBody(calls: CapturedCall[]): Record<string, unknown> {
  const patch = calls.find((c) => c.method === 'PATCH')
  if (!patch?.body) throw new Error('no PATCH issued')
  return patch.body
}

describe('toGbpPostalAddress', () => {
  it('maps a schema.org PostalAddress (what the site read yields) to GBP field names', () => {
    expect(
      toGbpPostalAddress({
        streetAddress: '560 Sutter St',
        addressLocality: 'San Francisco',
        addressRegion: 'CA',
        addressCountry: 'US',
        postalCode: '94102',
      })
    ).toEqual({
      addressLines: ['560 Sutter St'],
      locality: 'San Francisco',
      administrativeArea: 'CA',
      regionCode: 'US',
      postalCode: '94102',
    })
  })

  it('passes a GBP-native PostalAddress straight through', () => {
    const gbp = {
      regionCode: 'US',
      administrativeArea: 'CA',
      locality: 'San Francisco',
      postalCode: '94102',
      addressLines: ['560 Sutter St', 'Suite 200'],
    }
    expect(toGbpPostalAddress(gbp)).toEqual(gbp)
  })

  it('prefers GBP-native fields when both shapes are present', () => {
    expect(
      toGbpPostalAddress({
        locality: 'GBP City',
        addressLocality: 'SchemaOrg City',
        administrativeArea: 'WA',
        addressRegion: 'OR',
      })
    ).toEqual({ locality: 'GBP City', administrativeArea: 'WA' })
  })

  it('wraps a non-array addressLines into an array', () => {
    expect(toGbpPostalAddress({ addressLines: '560 Sutter St' })).toEqual({
      addressLines: ['560 Sutter St'],
    })
  })

  it('omits absent fields and tolerates null/undefined input', () => {
    expect(toGbpPostalAddress({ streetAddress: '1 Main St' })).toEqual({ addressLines: ['1 Main St'] })
    expect(toGbpPostalAddress(null)).toEqual({})
    expect(toGbpPostalAddress(undefined)).toEqual({})
  })

  it('treats an empty addressLines [] as absent: falls back to streetAddress, never emits [] (#5)', () => {
    // [] must not block the streetAddress fallback (and must not survive to wipe the street on merge)
    expect(toGbpPostalAddress({ addressLines: [], streetAddress: '1 Main St' })).toEqual({ addressLines: ['1 Main St'] })
    // [] with no fallback → addressLines omitted entirely, not emitted as []
    expect(toGbpPostalAddress({ addressLines: [], locality: 'Phoenix' })).toEqual({ locality: 'Phoenix' })
  })

  it('normalizes addressCountry: object shape, country name, and 2-letter code → CLDR (#8)', () => {
    // JSON-LD object-valued country
    expect(toGbpPostalAddress({ addressCountry: { '@type': 'Country', name: 'United States' } })).toEqual({ regionCode: 'US' })
    // full name
    expect(toGbpPostalAddress({ addressCountry: 'United States' })).toEqual({ regionCode: 'US' })
    // already a code (any case)
    expect(toGbpPostalAddress({ addressCountry: 'gb' })).toEqual({ regionCode: 'GB' })
    // GBP-native regionCode wins over schema addressCountry
    expect(toGbpPostalAddress({ regionCode: 'US', addressCountry: 'Canada' })).toEqual({ regionCode: 'US' })
  })
})

describe('toGbpRegularHours', () => {
  it('converts the day-keyed shape the agent produces into GBP periods', () => {
    expect(
      toGbpRegularHours({
        monday: { openTime: '11:00', closeTime: '22:00' },
        friday: { openTime: '11:00', closeTime: '23:00' },
      })
    ).toEqual({
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 11, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 22, minutes: 0 } },
        { openDay: 'FRIDAY', openTime: { hours: 11, minutes: 0 }, closeDay: 'FRIDAY', closeTime: { hours: 23, minutes: 0 } },
      ],
    })
  })

  it('converts a schema.org openingHoursSpecification array', () => {
    expect(
      toGbpRegularHours([
        { dayOfWeek: 'https://schema.org/Tuesday', opens: '09:00', closes: '17:30' },
        { dayOfWeek: ['Saturday', 'Sunday'], opens: '10:00', closes: '14:00' },
      ])
    ).toEqual({
      periods: [
        { openDay: 'TUESDAY', openTime: { hours: 9, minutes: 0 }, closeDay: 'TUESDAY', closeTime: { hours: 17, minutes: 30 } },
        { openDay: 'SATURDAY', openTime: { hours: 10, minutes: 0 }, closeDay: 'SATURDAY', closeTime: { hours: 14, minutes: 0 } },
        { openDay: 'SUNDAY', openTime: { hours: 10, minutes: 0 }, closeDay: 'SUNDAY', closeTime: { hours: 14, minutes: 0 } },
      ],
    })
  })

  it('passes GBP-native periods through, normalizing string times', () => {
    expect(
      toGbpRegularHours({
        periods: [
          { openDay: 'WEDNESDAY', openTime: { hours: 8, minutes: 15 }, closeDay: 'WEDNESDAY', closeTime: { hours: 16, minutes: 45 } },
          { openDay: 'THURSDAY', openTime: '08:00', closeTime: '16:00' },
        ],
      })
    ).toEqual({
      periods: [
        { openDay: 'WEDNESDAY', openTime: { hours: 8, minutes: 15 }, closeDay: 'WEDNESDAY', closeTime: { hours: 16, minutes: 45 } },
        { openDay: 'THURSDAY', openTime: { hours: 8, minutes: 0 }, closeDay: 'THURSDAY', closeTime: { hours: 16, minutes: 0 } },
      ],
    })
  })

  it('parses 12-hour AM/PM times', () => {
    expect(toGbpRegularHours({ monday: { open: '9:00 AM', close: '5:00 PM' } })).toEqual({
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 0 } },
      ],
    })
    expect(toGbpRegularHours({ monday: { open: '12:00 AM', close: '12:30 PM' } })).toEqual({
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 0, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 12, minutes: 30 } },
      ],
    })
  })

  it('drops days that are closed or have unparseable times', () => {
    expect(
      toGbpRegularHours({
        monday: { openTime: '09:00', closeTime: '17:00' },
        sunday: { openTime: 'Closed', closeTime: 'Closed' },
        tuesday: null,
      })
    ).toEqual({
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 0 } },
      ],
    })
  })

  it('returns empty periods for empty or non-object input', () => {
    expect(toGbpRegularHours({})).toEqual({ periods: [] })
    expect(toGbpRegularHours([])).toEqual({ periods: [] })
    expect(toGbpRegularHours(null)).toEqual({ periods: [] })
  })

  it('rolls an overnight period to the next day (#6)', () => {
    expect(toGbpRegularHours({ monday: { openTime: '22:00', closeTime: '02:00' } })).toEqual({
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 22, minutes: 0 }, closeDay: 'TUESDAY', closeTime: { hours: 2, minutes: 0 } },
      ],
    })
    // Saturday overnight wraps to Sunday (week wraps around).
    expect(toGbpRegularHours({ saturday: { openTime: '20:00', closeTime: '01:00' } }).periods[0]).toMatchObject({
      openDay: 'SATURDAY',
      closeDay: 'SUNDAY',
    })
    // Same-day hours keep closeDay = openDay.
    expect(toGbpRegularHours({ monday: { openTime: '09:00', closeTime: '17:00' } }).periods[0]).toMatchObject({
      openDay: 'MONDAY',
      closeDay: 'MONDAY',
    })
  })
})

describe('updateGoogleBusinessProfile guards (no PATCH on un-normalizable structured fields)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('throws instead of clearing the address when nothing maps to a GBP field', async () => {
    const { calls } = mockGbpFetch({})
    await expect(
      socialV2Client.updateGoogleBusinessProfile('token', 'loc', { storefrontAddress: { foo: 'bar' } } as never)
    ).rejects.toThrow(/Could not map the address/i)
    // Fails fast: no network round-trip (no pre-read, no PATCH).
    expect(calls).toHaveLength(0)
  })

  it('throws instead of wiping hours when no period is parseable', async () => {
    const { calls } = mockGbpFetch({})
    await expect(
      socialV2Client.updateGoogleBusinessProfile('token', 'loc', { regularHours: { someday: { open: 'noon' } } } as never)
    ).rejects.toThrow(/Could not map the hours/i)
    expect(calls).toHaveLength(0)
  })

  it('treats empty/whitespace name/phone/website as no-ops, never PATCHing a field clear (#7)', async () => {
    const { calls } = mockGbpFetch({})
    // All-empty → nothing to update, no PATCH.
    await expect(
      socialV2Client.updateGoogleBusinessProfile('token', 'loc', { name: '', primaryPhone: '   ', websiteUri: '' })
    ).rejects.toThrow(/No Google Business Profile fields to update/i)
    expect(calls.find((c) => c.method === 'PATCH')).toBeUndefined()
  })

  it('skips an empty field but still PATCHes the non-empty ones (#7)', async () => {
    const { calls } = mockGbpFetch({})
    await socialV2Client.updateGoogleBusinessProfile('token', 'loc', { name: '', websiteUri: 'https://x.test' })
    expect(patchedBody(calls)).toEqual({ websiteUri: 'https://x.test' })
  })

  it('writes description under profile with a profile.description mask', async () => {
    const { calls } = mockGbpFetch({})
    await socialV2Client.updateGoogleBusinessProfile('token', 'loc', { description: 'Family-owned plumbing since 1990.' })
    expect(patchedBody(calls)).toEqual({ profile: { description: 'Family-owned plumbing since 1990.' } })
  })

  it('treats an empty description as a no-op', async () => {
    const { calls } = mockGbpFetch({})
    await expect(
      socialV2Client.updateGoogleBusinessProfile('token', 'loc', { description: '   ' })
    ).rejects.toThrow(/No Google Business Profile fields to update/i)
    expect(calls.find((c) => c.method === 'PATCH')).toBeUndefined()
  })
})

describe('updateGoogleBusinessProfile read-then-merge (whole-field masks must not wipe subfields)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves additionalPhones when updating the primary phone', async () => {
    const { calls } = mockGbpFetch({
      phoneNumbers: { primaryPhone: '+1 415-111-1111', additionalPhones: ['+1 415-222-2222'] },
    })
    await socialV2Client.updateGoogleBusinessProfile('token', 'loc', { primaryPhone: '+1 415-999-9999' })
    expect(patchedBody(calls).phoneNumbers).toEqual({
      primaryPhone: '+1 415-999-9999',
      additionalPhones: ['+1 415-222-2222'],
    })
  })

  it('merges a partial address onto the current one instead of clearing the untouched lines', async () => {
    const { calls } = mockGbpFetch({
      storefrontAddress: {
        regionCode: 'US',
        administrativeArea: 'CA',
        locality: 'Old City',
        postalCode: '94102',
        addressLines: ['560 Sutter St'],
      },
    })
    // schema.org locality only — must NOT wipe street/state/zip/country.
    await socialV2Client.updateGoogleBusinessProfile('token', 'loc', {
      storefrontAddress: { addressLocality: 'New City' },
    } as never)
    expect(patchedBody(calls).storefrontAddress).toEqual({
      regionCode: 'US',
      administrativeArea: 'CA',
      locality: 'New City',
      postalCode: '94102',
      addressLines: ['560 Sutter St'],
    })
  })

  it('does not pre-read for fields that are replaced wholesale (name/website/hours)', async () => {
    const { calls } = mockGbpFetch({})
    await socialV2Client.updateGoogleBusinessProfile('token', 'loc', { name: 'New Name', websiteUri: 'https://x.test' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('PATCH')
  })
})
