import { describe, expect, it } from 'vitest'

import { tryFormatAsUSPhone, validatePhoneNumber } from '@/lib/inbox/format/phone'

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

describe('validatePhoneNumber', () => {
  it('returns E.164 for a valid 10-digit number, with or without separators', () => {
    expect(validatePhoneNumber('4805551234')).toBe('+14805551234')
    expect(validatePhoneNumber('(480) 555-1234')).toBe('+14805551234')
    expect(validatePhoneNumber('480.555.1234')).toBe('+14805551234')
  })

  it('strips the leading 1 from a valid 11-digit number', () => {
    expect(validatePhoneNumber('14805551234')).toBe('+14805551234')
    expect(validatePhoneNumber('+1 (480) 555-1234')).toBe('+14805551234')
  })

  it('rejects NANP numbers whose area code starts with 0 or 1', () => {
    expect(validatePhoneNumber('0805551234')).toBeUndefined()
    expect(validatePhoneNumber('1805551234')).toBeUndefined()
  })

  it('rejects NANP numbers whose exchange code starts with 0 or 1', () => {
    expect(validatePhoneNumber('4800551234')).toBeUndefined()
    expect(validatePhoneNumber('4801551234')).toBeUndefined()
  })

  it('rejects numbers with the wrong digit count', () => {
    expect(validatePhoneNumber('12345')).toBeUndefined()
    expect(validatePhoneNumber('480555123')).toBeUndefined()
    expect(validatePhoneNumber('24805551234')).toBeUndefined()
  })
})
