import { describe, expect, it } from 'vitest';

import { authUtils } from '@/lib/features';

describe('authUtils', () => {
  describe('getSupportedAuthTypes', () => {
    it('should return all auth types accepted by gd-auth-lib', () => {
      const types = authUtils.getSupportedAuthTypes();

      expect(types).toEqual(['basic', 'e2s', 's2s', 'e2s2s', 'e2s2p', 'e2s2snpr', 'cert2s', 'e2p', 's2p', 's2snpr']);

      expect(types).toHaveLength(10);

      // Verify key types are present
      expect(types).toContain('basic');
      expect(types).toContain('e2s');
      expect(types).toContain('s2s');
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
