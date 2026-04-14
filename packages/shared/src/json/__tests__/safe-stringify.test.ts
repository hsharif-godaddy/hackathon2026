import { describe, expect, it } from 'vitest'
import { safeStringify } from '../safe-stringify.js'

describe('safeStringify', () => {
  it('serializes plain objects normally', () => {
    expect(safeStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}')
  })

  it('serializes arrays normally', () => {
    expect(safeStringify([1, 2, 3])).toBe('[1,2,3]')
  })

  it('handles null and undefined', () => {
    expect(safeStringify(null)).toBe('null')
    expect(safeStringify(undefined)).toBe(undefined)
  })

  it('handles primitives', () => {
    expect(safeStringify('hello')).toBe('"hello"')
    expect(safeStringify(42)).toBe('42')
    expect(safeStringify(true)).toBe('true')
  })

  it('replaces self-referencing circular references', () => {
    const obj: any = { a: 1 }
    obj.self = obj
    expect(safeStringify(obj)).toBe('{"a":1,"self":"[Circular]"}')
  })

  it('replaces nested circular references', () => {
    const parent: any = { name: 'parent' }
    const child: any = { name: 'child', parent }
    parent.child = child
    const result = JSON.parse(safeStringify(parent))
    expect(result.name).toBe('parent')
    expect(result.child.name).toBe('child')
    expect(result.child.parent).toBe('[Circular]')
  })

  it('handles circular references in arrays', () => {
    const arr: any[] = [1, 2]
    arr.push(arr)
    expect(safeStringify(arr)).toBe('[1,2,"[Circular]"]')
  })

  it('supports space parameter for formatting', () => {
    const result = safeStringify({ a: 1 }, 2)
    expect(result).toBe('{\n  "a": 1\n}')
  })

  it('supports string space parameter', () => {
    const result = safeStringify({ a: 1 }, '\t')
    expect(result).toBe('{\n\t"a": 1\n}')
  })

  it('handles deeply nested objects without circular refs', () => {
    const obj = { a: { b: { c: { d: 'deep' } } } }
    expect(safeStringify(obj)).toBe('{"a":{"b":{"c":{"d":"deep"}}}}')
  })

  it('does not replace shared non-circular references', () => {
    const shared = { x: 1 }
    expect(safeStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
  })

  it('does not replace shared references in arrays', () => {
    const shared = { x: 1 }
    expect(safeStringify([shared, shared])).toBe('[{"x":1},{"x":1}]')
  })
})
