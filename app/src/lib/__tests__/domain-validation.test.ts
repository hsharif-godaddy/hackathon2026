import { describe, expect, it } from 'vitest';

import { validateDomainName } from '../domain-validation';

describe('validateDomainName', () => {
  describe('valid domains', () => {
    it('should accept standard domain', () => {
      expect(validateDomainName('example.com')).toEqual({ valid: true });
    });

    it('should accept subdomain', () => {
      expect(validateDomainName('sub.example.com')).toEqual({ valid: true });
    });

    it('should accept domain with hyphens', () => {
      expect(validateDomainName('my-brand.com')).toEqual({ valid: true });
    });

    it('should accept domain with numbers', () => {
      expect(validateDomainName('brand123.com')).toEqual({ valid: true });
    });

    it('should accept two-part TLD', () => {
      expect(validateDomainName('example.co.uk')).toEqual({ valid: true });
    });

    it('should accept maximum label length (63 chars)', () => {
      const label = 'a'.repeat(63);
      expect(validateDomainName(`${label}.com`)).toEqual({ valid: true });
    });

    it('should accept mixed case', () => {
      expect(validateDomainName('Example.COM')).toEqual({ valid: true });
    });
  });

  describe('invalid domains', () => {
    it('should reject domain exceeding 253 characters', () => {
      const longDomain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`;
      const result = validateDomainName(longDomain);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('253');
    });

    it('should reject domain with invalid characters', () => {
      const result = validateDomainName('exam ple.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('should reject domain with underscores', () => {
      const result = validateDomainName('my_brand.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('should reject single label (no dot)', () => {
      const result = validateDomainName('localhost');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least two labels');
    });

    it('should reject empty label (consecutive dots)', () => {
      const result = validateDomainName('example..com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 63');
    });

    it('should reject label starting with hyphen', () => {
      const result = validateDomainName('-example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hyphen');
    });

    it('should reject label ending with hyphen', () => {
      const result = validateDomainName('example-.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hyphen');
    });

    it('should reject label exceeding 63 characters', () => {
      const label = 'a'.repeat(64);
      const result = validateDomainName(`${label}.com`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 63');
    });

    it('should reject non-string input', () => {
      const result = validateDomainName(123 as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a string');
    });

    it('should reject domain with special characters', () => {
      const result = validateDomainName('example@domain.com');
      expect(result.valid).toBe(false);
    });

    it('should reject domain with leading dot after split', () => {
      const result = validateDomainName('.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 63');
    });

    it('should reject domain with trailing dot', () => {
      const result = validateDomainName('example.com.');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 63');
    });
  });
});
