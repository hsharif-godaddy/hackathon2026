import { describe, it, expect } from 'vitest';
import { hasBeenPublished } from './site';

describe('hasBeenPublished', () => {
  describe('with publish variant', () => {
    it('should return true when variants includes "publish"', () => {
      const site = {
        variants: ['preview', 'publish'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when only publish variant exists', () => {
      const site = {
        variants: ['publish'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when publish is first in variants array', () => {
      const site = {
        variants: ['publish', 'preview'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should return true when publish is in middle of variants array', () => {
      const site = {
        variants: ['preview', 'publish', 'staging'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });
  });

  describe('without publish variant', () => {
    it('should return false when variants only includes "preview"', () => {
      const site = {
        variants: ['preview'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when variants is empty array', () => {
      const site = {
        variants: [],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should return false when variants has other values but not publish', () => {
      const site = {
        variants: ['preview', 'staging', 'development'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });
  });

  describe('null and undefined handling', () => {
    it('should return false when site is null', () => {
      expect(hasBeenPublished(null)).toBe(false);
    });

    it('should return false when site is undefined', () => {
      expect(hasBeenPublished(undefined)).toBe(false);
    });

    it('should return false when variants is undefined', () => {
      const site = {
        variants: undefined,
      };
      expect(hasBeenPublished(site as any)).toBe(false);
    });

    it('should return false when variants is null', () => {
      const site = {
        variants: null,
      };
      expect(hasBeenPublished(site as any)).toBe(false);
    });

    it('should return false when site object is empty', () => {
      const site = {};
      expect(hasBeenPublished(site as any)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should be case-sensitive for "publish"', () => {
      const siteUpperCase = {
        variants: ['Publish'],
      };
      expect(hasBeenPublished(siteUpperCase)).toBe(false);

      const siteMixedCase = {
        variants: ['PUBLISH'],
      };
      expect(hasBeenPublished(siteMixedCase)).toBe(false);
    });

    it('should not match partial strings', () => {
      const site = {
        variants: ['published', 'pre-publish', 'publishable'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should handle duplicate "publish" entries', () => {
      const site = {
        variants: ['publish', 'preview', 'publish'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should handle variants with whitespace', () => {
      const site = {
        variants: [' publish ', 'preview'],
      };
      expect(hasBeenPublished(site)).toBe(false);
    });

    it('should handle empty strings in variants', () => {
      const site = {
        variants: ['', 'publish', ''],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });
  });

  describe('type compatibility', () => {
    it('should work with minimal site object', () => {
      const site: Pick<{ variants?: string[] }, 'variants'> = {
        variants: ['publish'],
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should work with full SiteInfo interface', () => {
      const site = {
        id: 'site-123',
        name: 'My Site',
        variants: ['preview', 'publish'],
        createdAt: new Date(),
      };
      expect(hasBeenPublished(site)).toBe(true);
    });

    it('should work with readonly variants array', () => {
      const site = {
        variants: ['publish', 'preview'] as readonly string[],
      };
      expect(hasBeenPublished(site as any)).toBe(true);
    });
  });

  describe('boolean consistency', () => {
    it('should always return boolean', () => {
      expect(typeof hasBeenPublished({ variants: ['publish'] })).toBe('boolean');
      expect(typeof hasBeenPublished({ variants: [] })).toBe('boolean');
      expect(typeof hasBeenPublished(null)).toBe('boolean');
      expect(typeof hasBeenPublished(undefined)).toBe('boolean');
    });

    it('should return true or false, never truthy/falsy values', () => {
      const result1 = hasBeenPublished({ variants: ['publish'] });
      const result2 = hasBeenPublished({ variants: [] });

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result1).not.toBe(1);
      expect(result2).not.toBe(0);
    });
  });
});
