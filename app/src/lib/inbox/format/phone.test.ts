import { describe, expect, it } from 'vitest'

import { tryFormatAsUSPhone } from '@/lib/inbox/format/phone'

describe('tryFormatAsUSPhone', () => {
  it('formats a bare 10-digit number as (xxx) xxx-xxxx', () => {
    expect(tryFormatAsUSPhone('4805551234')).toBe('(480) 555-1234')
  })

  it('formats a 10-digit number that contains separators', () => {
    expect(tryFormatAsUSPhone('(480) 555-1234')).toBe('(480) 555-1234')
    expect(tryFormatAsUSPhone('480.555.1234')).toBe('(480) 555-1234')
    expect(tryFormatAsUSPhone('480-555-1234')).toBe('(480) 555-1234')
  })

  it('strips the US country code from an 11-digit number starting with 1', () => {
    expect(tryFormatAsUSPhone('+14805551234')).toBe('(480) 555-1234')
    expect(tryFormatAsUSPhone('14805551234')).toBe('(480) 555-1234')
  })

  it('formats a non-US 11-digit number with the country-code layout', () => {
    // 11 digits not starting with 1 → +x xxx xxx xxxx
    expect(tryFormatAsUSPhone('+33612345678')).toBe('+3 361 234 5678')
  })

  it('returns the input unchanged when it is too short to be phone-like', () => {
    expect(tryFormatAsUSPhone('12345')).toBe('12345')
  })

  it('returns the input unchanged when it contains non-phone characters', () => {
    expect(tryFormatAsUSPhone('not-a-phone-number')).toBe('not-a-phone-number')
  })

  it('returns the input unchanged when digit count is not 10 or 11', () => {
    // phone-like (>=10 chars, allowed charset) but 12 digits
    expect(tryFormatAsUSPhone('+12 345 678 9012')).toBe('+12 345 678 9012')
  })
})
