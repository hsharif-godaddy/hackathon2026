import { describe, expect, it } from 'vitest';

import { authUtils } from '@/lib/features';

describe('authUtils', () => {
  describe('getSupportedAuthTypes', () => {
    it('should return all 12 auth types supported by gd-auth', () => {
      const types = authUtils.getSupportedAuthTypes();

      expect(types).toEqual(['basic', 'e2s', 's2s', 'e2s2s', 'e2s2p', 'e2s2snpr', 'e2s2s2p', 'cert2s', 'e2p', 's2p', 's2snpr', 's2s2p']);
      expect(types).toHaveLength(12);
      expect(types).toContain('basic');
      expect(types).toContain('e2s');
      expect(types).toContain('s2s');
    });
  });
});
