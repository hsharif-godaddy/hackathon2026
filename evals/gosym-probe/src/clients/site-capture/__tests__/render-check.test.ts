import { describe, it, expect, vi } from 'vitest';

import { captureRenderedSignals, isRouteEmpty } from '../render-check.js';

interface FakePage {
  evaluate: ReturnType<typeof vi.fn>;
}

function pageReturning(signals: {
  title: string;
  h1: string | null;
  headingText: string;
  bodyPreview: string;
}): FakePage {
  return {
    evaluate: vi.fn().mockResolvedValue(signals),
  };
}

describe('util/render-check', () => {
  describe('captureRenderedSignals', () => {
    it('captures title, h1, headingText, and bodyPreview', async () => {
      const page = pageReturning({
        title: 'Welcome to Favs 4 U',
        h1: 'Welcome',
        headingText: 'Welcome | About us',
        bodyPreview: 'Sign up for great deals and win prizes.',
      });

      const result = await captureRenderedSignals(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page as any,
      );

      expect(result.title).toBe('Welcome to Favs 4 U');
      expect(result.h1).toBe('Welcome');
      expect(result.headingText).toBe('Welcome | About us');
      expect(result.bodyPreview).toBe('Sign up for great deals and win prizes.');
    });
  });

  describe('isRouteEmpty', () => {
    it('returns true when all signals are empty', () => {
      expect(isRouteEmpty({
        title: '',
        h1: null,
        headingText: '',
        bodyPreview: '',
      })).toBe(true);
    });

    it('returns true when bodyPreview is whitespace-only', () => {
      expect(isRouteEmpty({
        title: '',
        h1: null,
        headingText: '',
        bodyPreview: '   \n  ',
      })).toBe(true);
    });

    it('returns false when title is present', () => {
      expect(isRouteEmpty({
        title: 'My App',
        h1: null,
        headingText: '',
        bodyPreview: '',
      })).toBe(false);
    });

    it('returns false when h1 is present', () => {
      expect(isRouteEmpty({
        title: '',
        h1: 'Welcome',
        headingText: '',
        bodyPreview: '',
      })).toBe(false);
    });

    it('returns false when headingText is present', () => {
      expect(isRouteEmpty({
        title: '',
        h1: null,
        headingText: 'About us',
        bodyPreview: '',
      })).toBe(false);
    });

    it('returns false when bodyPreview has content', () => {
      expect(isRouteEmpty({
        title: '',
        h1: null,
        headingText: '',
        bodyPreview: 'Some actual content here.',
      })).toBe(false);
    });

    it('returns false for a 404 page with visible text', () => {
      expect(isRouteEmpty({
        title: '404 - Page Not Found',
        h1: 'Page not found',
        headingText: 'Page not found',
        bodyPreview: 'Nothing to see here',
      })).toBe(false);
    });
  });
});
