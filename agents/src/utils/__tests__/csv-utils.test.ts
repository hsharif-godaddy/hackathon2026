import { describe, expect, it } from 'vitest'

import { escapeCSVField, formatCSVHeader, formatCSVRow } from '../csv-utils.js'

describe('csv-utils', () => {
  describe('escapeCSVField', () => {
    it('should return empty string for null', () => {
      expect(escapeCSVField(null)).toBe('')
    })

    it('should return empty string for undefined', () => {
      expect(escapeCSVField(undefined)).toBe('')
    })

    it('should quote boolean true', () => {
      expect(escapeCSVField(true)).toBe('"true"')
    })

    it('should quote boolean false', () => {
      expect(escapeCSVField(false)).toBe('"false"')
    })

    it('should quote a simple string', () => {
      expect(escapeCSVField('hello')).toBe('"hello"')
    })

    it('should quote a number', () => {
      expect(escapeCSVField(42)).toBe('"42"')
    })

    it('should double embedded quotes', () => {
      expect(escapeCSVField('say "hello"')).toBe('"say ""hello"""')
    })

    it('should handle string with commas', () => {
      expect(escapeCSVField('a,b,c')).toBe('"a,b,c"')
    })

    it('should handle string with newlines', () => {
      expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"')
    })

    it('should handle string with carriage return', () => {
      expect(escapeCSVField('line1\r\nline2')).toBe('"line1\r\nline2"')
    })

    it('should JSON stringify objects and double quotes', () => {
      expect(escapeCSVField({ a: 1 })).toBe('"{""a"":1}"')
    })

    it('should JSON stringify arrays and double quotes', () => {
      expect(escapeCSVField([1, 2])).toBe('"[1,2]"')
    })

    it('should preserve unicode characters', () => {
      expect(escapeCSVField('café ñ 日本語')).toBe('"café ñ 日本語"')
    })

    it('should handle empty string', () => {
      expect(escapeCSVField('')).toBe('""')
    })
  })

  describe('formatCSVHeader', () => {
    it('should format column names as CSV header', () => {
      expect(formatCSVHeader(['id', 'name', 'email'])).toBe('"id","name","email"')
    })

    it('should handle column names with special characters', () => {
      expect(formatCSVHeader(['user "name"', 'a,b'])).toBe('"user ""name""","a,b"')
    })

    it('should handle empty columns', () => {
      expect(formatCSVHeader([])).toBe('')
    })
  })

  describe('formatCSVRow', () => {
    it('should format row values in column order', () => {
      const row = { name: 'Alice', id: 1, email: 'a@b.com' }
      const columns = ['id', 'name', 'email']
      expect(formatCSVRow(row, columns)).toBe('"1","Alice","a@b.com"')
    })

    it('should handle missing columns as undefined (empty)', () => {
      const row = { id: 1 }
      const columns = ['id', 'missing']
      expect(formatCSVRow(row, columns)).toBe('"1",')
    })

    it('should handle null values', () => {
      const row = { id: 1, name: null }
      const columns = ['id', 'name']
      expect(formatCSVRow(row, columns)).toBe('"1",')
    })

    it('should handle mixed types', () => {
      const row = { id: 1, active: true, data: { x: 1 }, name: null }
      const columns = ['id', 'active', 'data', 'name']
      expect(formatCSVRow(row, columns)).toBe('"1","true","{""x"":1}",')
    })
  })
})
