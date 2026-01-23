import { describe, expect, it } from 'vitest';

import { authUtils } from '@/lib/features';

describe('authUtils', () => {
  describe('getSupportedAuthTypes', () => {
    it('should return all supported auth types including s2s', () => {
      const types = authUtils.getSupportedAuthTypes();

      expect(types).toEqual(['basic', 'e2s', 's2s']);
      expect(types).toContain('s2s'); // Specifically check for s2s support
    });
  });

  describe('detectAuthTypeFromToken', () => {
    it('should return "basic" for tokens without auth field', () => {
      const token = createMockToken({
        shopperId: 'test-123',
        cid: 'customer-123'
      });

      const authType = authUtils.detectAuthTypeFromToken(token);

      expect(authType).toBe('basic');
    });

    it('should detect e2s from auth field', () => {
      const token = createMockToken({
        auth: 'e2s',
        shopperId: 'employee-123',
        e2s: {
          shopperId: 'customer-456',
          cid: 'customer-cid'
        }
      });

      const authType = authUtils.detectAuthTypeFromToken(token);

      expect(authType).toBe('e2s');
    });

    it('should detect s2s from auth field', () => {
      const token = createMockToken({
        auth: 's2s',
        shopperId: 'wdd-123',
        s2s: {
          shopperId: 'client-456',
          cid: 'client-cid'
        }
      });

      const authType = authUtils.detectAuthTypeFromToken(token);

      expect(authType).toBe('s2s');
    });

    it('should detect e2s from nested object if no auth field', () => {
      const token = createMockToken({
        shopperId: 'employee-123',
        e2s: {
          shopperId: 'customer-456',
          cid: 'customer-cid'
        }
      });

      const authType = authUtils.detectAuthTypeFromToken(token);

      expect(authType).toBe('e2s');
    });

    it('should detect s2s from nested object if no auth field', () => {
      const token = createMockToken({
        shopperId: 'wdd-123',
        s2s: {
          shopperId: 'client-456',
          cid: 'client-cid'
        }
      });

      const authType = authUtils.detectAuthTypeFromToken(token);

      expect(authType).toBe('s2s');
    });

    it('should return "basic" for invalid tokens', () => {
      const authType = authUtils.detectAuthTypeFromToken('invalid-token');

      expect(authType).toBe('basic');
    });

    it('should return "basic" for empty tokens', () => {
      const authType = authUtils.detectAuthTypeFromToken('');

      expect(authType).toBe('basic');
    });
  });

  describe('isE2SToken', () => {
    it('should return true for e2s tokens', () => {
      const token = createMockToken({
        auth: 'e2s',
        e2s: {
          shopperId: 'customer-456'
        }
      });

      expect(authUtils.isE2SToken(token)).toBe(true);
    });

    it('should return false for s2s tokens', () => {
      const token = createMockToken({
        auth: 's2s',
        s2s: {
          shopperId: 'client-456'
        }
      });

      expect(authUtils.isE2SToken(token)).toBe(false);
    });

    it('should return false for basic tokens', () => {
      const token = createMockToken({
        shopperId: 'test-123'
      });

      expect(authUtils.isE2SToken(token)).toBe(false);
    });
  });
});

/**
 * Helper to create mock JWT tokens for testing
 */
function createMockToken(payload: any): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock-signature';

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
