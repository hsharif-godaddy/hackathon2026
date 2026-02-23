import { describe, expect, it } from 'vitest'

import { validateDomainName } from '../domain-validation.js'

describe('domain-validation', function domainValidationTests() {
  describe('#validateDomainName', function validateTests() {
    describe('valid domains', function validTests() {
      it('should accept standard domain', function standard() {
        expect(validateDomainName('example.com')).toEqual({ valid: true })
      })

      it('should accept subdomain', function subdomain() {
        expect(validateDomainName('sub.example.com')).toEqual({ valid: true })
      })

      it('should accept deeply nested subdomains', function deepSubdomain() {
        expect(validateDomainName('a.b.c.d.example.com')).toEqual({ valid: true })
      })

      it('should accept domain with hyphens', function hyphens() {
        expect(validateDomainName('my-brand.com')).toEqual({ valid: true })
      })

      it('should accept domain with numbers', function numbers() {
        expect(validateDomainName('brand123.com')).toEqual({ valid: true })
      })

      it('should accept labels starting with digits (RFC 1123)', function digitStart() {
        expect(validateDomainName('123example.com')).toEqual({ valid: true })
        expect(validateDomainName('42.com')).toEqual({ valid: true })
      })

      it('should accept two-part TLD', function twoPartTld() {
        expect(validateDomainName('example.co.uk')).toEqual({ valid: true })
      })

      it('should accept maximum label length of 63 chars', function maxLabel() {
        expect(validateDomainName(`${'a'.repeat(63)}.com`)).toEqual({ valid: true })
      })

      it('should accept mixed case', function mixedCase() {
        expect(validateDomainName('Example.COM')).toEqual({ valid: true })
      })

      it('should accept domain with leading/trailing whitespace (trimmed)', function trimmed() {
        expect(validateDomainName('  example.com  ')).toEqual({ valid: true })
        expect(validateDomainName('\texample.com\n')).toEqual({ valid: true })
      })
    })

    describe('empty and whitespace input', function emptyTests() {
      it('should reject empty string', function empty() {
        const result = validateDomainName('')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('cannot be empty')
      })

      it('should reject whitespace-only string', function whitespaceOnly() {
        const result = validateDomainName('   ')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('cannot be empty')
      })

      it('should reject tab/newline-only string', function tabNewline() {
        const result = validateDomainName('\t\n')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('cannot be empty')
      })

      it('should reject non-string input', function nonString() {
        const result = validateDomainName(123 as any)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('must be a string')
      })

      it('should reject null input', function nullInput() {
        const result = validateDomainName(null as any)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('must be a string')
      })

      it('should reject undefined input', function undefinedInput() {
        const result = validateDomainName(undefined as any)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('must be a string')
      })
    })

    describe('invalid characters', function invalidCharTests() {
      it('should reject domain with spaces', function spaces() {
        const result = validateDomainName('exam ple.com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('invalid characters')
      })

      it('should reject domain with underscores', function underscores() {
        const result = validateDomainName('my_brand.com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('invalid characters')
      })

      it('should reject domain with special characters', function specialChars() {
        expect(validateDomainName('example@domain.com').valid).toBe(false)
        expect(validateDomainName('example!domain.com').valid).toBe(false)
        expect(validateDomainName('example#domain.com').valid).toBe(false)
      })
    })

    describe('label structure', function labelTests() {
      it('should reject single label (no TLD)', function singleLabel() {
        const result = validateDomainName('localhost')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('at least two labels')
      })

      it('should reject consecutive dots (empty label)', function consecutiveDots() {
        const result = validateDomainName('example..com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('between 1 and 63')
      })

      it('should reject leading dot (empty first label)', function leadingDot() {
        const result = validateDomainName('.example.com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('between 1 and 63')
      })

      it('should reject trailing dot (empty last label)', function trailingDot() {
        const result = validateDomainName('example.com.')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('between 1 and 63')
      })

      it('should reject label starting with hyphen', function startHyphen() {
        const result = validateDomainName('-example.com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('hyphen')
      })

      it('should reject label ending with hyphen', function endHyphen() {
        const result = validateDomainName('example-.com')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('hyphen')
      })

      it('should reject label exceeding 63 characters', function longLabel() {
        const result = validateDomainName(`${'a'.repeat(64)}.com`)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('between 1 and 63')
      })
    })

    describe('length limits', function lengthTests() {
      it('should reject domain exceeding 253 characters', function tooLong() {
        const result = validateDomainName(
          `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`
        )
        expect(result.valid).toBe(false)
        expect(result.error).toContain('253')
      })

      it('should accept domain at exactly 253 characters', function exactly253() {
        // 63 + 1 + 63 + 1 + 63 + 1 + 58 + 1 + 2 = 253
        const domain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.co`
        expect(domain.length).toBe(253)
        expect(validateDomainName(domain)).toEqual({ valid: true })
      })
    })

    describe('ReDoS protection', function redosTests() {
      it('should handle long input efficiently', function longInput() {
        const start = Date.now()
        validateDomainName('a'.repeat(1000) + '.com')
        expect(Date.now() - start).toBeLessThan(100)
      })

      it('should handle pathological patterns efficiently', function pathological() {
        const patterns = [
          'a-'.repeat(100) + 'a.com',
          '.'.repeat(200),
          '-'.repeat(200),
        ]

        for (const pattern of patterns) {
          const start = Date.now()
          validateDomainName(pattern)
          expect(Date.now() - start).toBeLessThan(50)
        }
      })
    })
  })
})
