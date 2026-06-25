import { describe, it, expect } from 'vitest'
import { generateUcid } from '../identity.js'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateUcid', () => {
  it('returns an RFC4122 v4 UUID string', () => {
    const ucid = generateUcid()
    expect(ucid).toMatch(UUID_V4_PATTERN)
  })

  it('returns a different value on each call', () => {
    const a = generateUcid()
    const b = generateUcid()
    expect(a).not.toBe(b)
  })
})
