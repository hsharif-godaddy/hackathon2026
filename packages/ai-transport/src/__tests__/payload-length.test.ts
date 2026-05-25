import { describe, it, expect } from 'vitest'
import { stringPayloadLength } from '../payload-length.js'

describe('stringPayloadLength', () => {
  it('returns 0 for null and undefined', () => {
    expect(stringPayloadLength(null)).toBe(0)
    expect(stringPayloadLength(undefined)).toBe(0)
  })

  it('returns string length for strings', () => {
    expect(stringPayloadLength('')).toBe(0)
    expect(stringPayloadLength('hello')).toBe(5)
  })

  it('returns 0 for numbers and booleans', () => {
    expect(stringPayloadLength(42)).toBe(0)
    expect(stringPayloadLength(true)).toBe(0)
    expect(stringPayloadLength(false)).toBe(0)
  })

  it('sums string lengths in flat objects', () => {
    expect(stringPayloadLength({ a: 'hi', b: 'bye' })).toBe(5)
  })

  it('sums string lengths in arrays', () => {
    expect(stringPayloadLength(['abc', 'de'])).toBe(5)
  })

  it('recurses into nested structures', () => {
    const nested = {
      level1: 'aa',
      child: {
        level2: 'bbb',
        items: ['c', 'dd'],
      },
    }
    expect(stringPayloadLength(nested)).toBe(2 + 3 + 1 + 2)
  })

  it('skips non-string values in mixed objects', () => {
    expect(stringPayloadLength({ s: 'hi', n: 123, b: true, u: undefined, nil: null })).toBe(2)
  })

  it('handles circular references without infinite loop', () => {
    const obj: Record<string, unknown> = { name: 'test' }
    obj.self = obj
    expect(stringPayloadLength(obj)).toBe(4)
  })

  it('handles shared references counted once per visit', () => {
    const shared = { val: 'shared' }
    const root = { a: shared, b: shared }
    // shared.val = 6 chars, counted once (second visit sees it in WeakSet)
    expect(stringPayloadLength(root)).toBe(6)
  })

  it('accepts an external seen set', () => {
    const seen = new WeakSet<object>()
    const obj = { x: 'hello' }
    seen.add(obj)
    // Already in seen — returns 0
    expect(stringPayloadLength(obj, seen)).toBe(0)
  })
})
