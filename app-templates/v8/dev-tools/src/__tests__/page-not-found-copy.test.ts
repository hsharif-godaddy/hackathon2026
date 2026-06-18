import { describe, expect, it } from 'vitest';

import {
  PAGE_NOT_FOUND_TITLE,
  formatPageNameFromPathname,
  getPageNotFoundMessage,
} from '../page-not-found-copy';

describe('page-not-found-copy', function packageTests() {
  describe('#formatPageNameFromPathname', function formatPageNameTests() {
    it('title-cases a single segment', function singleSegment() {
      expect(formatPageNameFromPathname('/about')).toBe('About');
    });

    it('title-cases kebab-case segments', function kebabCase() {
      expect(formatPageNameFromPathname('/visit-us')).toBe('Visit Us');
    });

    it('uses the last path segment', function lastSegment() {
      expect(formatPageNameFromPathname('/shop/visit-us')).toBe('Visit Us');
    });

    it('falls back when pathname has no segments', function emptyPath() {
      expect(formatPageNameFromPathname('/')).toBe('This page');
    });
  });

  describe('#getPageNotFoundMessage', function messageTests() {
    it('returns idle copy when agent is not busy', function idleCopy() {
      expect(getPageNotFoundMessage('Visit Us', false)).toBe(
        'Visit Us is planned for your project. Ready to build it now?',
      );
    });

    it('returns busy copy when agent is busy', function busyCopy() {
      expect(getPageNotFoundMessage('Visit Us', true)).toBe(
        "Airo's finishing another task. Check back when it's done to build Visit Us.",
      );
    });
  });

  describe('PAGE_NOT_FOUND_TITLE', function titleTests() {
    it('uses the shared headline for both states', function sharedTitle() {
      expect(PAGE_NOT_FOUND_TITLE).toBe("This page isn't built yet");
    });
  });
});
