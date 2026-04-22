import { describe, expect, it } from 'vitest';

import { buildSiteTypeRules, normalizeSiteType } from '../site-type-helpers.js';

describe('site-type-helpers', () => {
  describe('#normalizeSiteType', () => {
    it('maps known labels case-insensitively', () => {
      expect(normalizeSiteType('APP')).toBe('app');
      expect(normalizeSiteType('  Dashboard  ')).toBe('dashboard');
    });

    it('defaults for unknown or non-strings', () => {
      expect(normalizeSiteType('blog')).toBe('content');
      expect(normalizeSiteType('')).toBe('content');
      expect(normalizeSiteType(null)).toBe('content');
      expect(normalizeSiteType(12)).toBe('content');
    });
  });

  describe('#buildSiteTypeRules', () => {
    it('uses content homepage rules for content first page', () => {
      const text = buildSiteTypeRules('content', true);
      expect(text).toContain('CONTENT site homepage');
      expect(text).toContain('header');
      expect(text).toContain('hero');
    });

    it('uses inner-page rules for content when not first page', () => {
      const text = buildSiteTypeRules('content', false);
      expect(text).toContain('inner page');
      expect(text).toContain('page-specific');
      expect(text).not.toContain('homepage structure');
    });

    it('uses commerce homepage rules for commerce first page', () => {
      const text = buildSiteTypeRules('commerce', true);
      expect(text).toContain('storefront');
      expect(text).toContain('Product grid');
      expect(text).not.toContain('FULL-VIEWPORT');
    });

    it('uses inner-page rules for non-content types when not first page', () => {
      const text = buildSiteTypeRules('dashboard', false);
      expect(text).toContain('Inner page');
      expect(text).toContain('dashboard');
    });

    it('uses app shell rules for app homepages', () => {
      const text = buildSiteTypeRules('app', true);
      expect(text).toContain('FULL-VIEWPORT');
      expect(text).toContain('No marketing hero');
    });
  });
});
