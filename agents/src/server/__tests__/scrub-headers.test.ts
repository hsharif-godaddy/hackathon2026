import { describe, it, expect } from 'vitest'

import { scrubHeaderValue, scrubHeadersForLog } from '../scrub-headers.js'

describe('scrubHeaderValue', () => {
  it('preserves the scheme and first/last two chars of the secret', () => {
    expect(scrubHeaderValue('ApiKey abcd1234')).toBe('ApiKey ab<redacted>34')
    expect(scrubHeaderValue('Bearer abcdefghij')).toBe('Bearer ab<redacted>ij')
  })

  it('fully redacts a secret of four chars or fewer', () => {
    expect(scrubHeaderValue('Bearer abcd')).toBe('Bearer <redacted>')
    expect(scrubHeaderValue('ApiKey x')).toBe('ApiKey <redacted>')
  })

  it('handles a value with no scheme (whole value is the secret)', () => {
    expect(scrubHeaderValue('abcd1234')).toBe('ab<redacted>34')
    expect(scrubHeaderValue('abcd')).toBe('<redacted>')
  })
})

describe('scrubHeadersForLog', () => {
  it('scrubs Authorization, *api-key*, and *token* headers (case-insensitive)', () => {
    const scrubbed = scrubHeadersForLog({
      Authorization: 'ApiKey abcd1234',
      'X-Api-Key': 'secretvalue',
      'x-auth-token': 'tokenvalue',
    })
    expect(scrubbed.Authorization).toBe('ApiKey ab<redacted>34')
    expect(scrubbed['X-Api-Key']).toBe('se<redacted>ue')
    expect(scrubbed['x-auth-token']).toBe('to<redacted>ue')
  })

  it('passes non-secret headers (e.g. Content-Type) through verbatim', () => {
    const scrubbed = scrubHeadersForLog({
      'Content-Type': 'application/x-protobuf',
      Authorization: 'ApiKey abcd1234',
    })
    expect(scrubbed['Content-Type']).toBe('application/x-protobuf')
    expect(scrubbed.Authorization).toBe('ApiKey ab<redacted>34')
  })
})
