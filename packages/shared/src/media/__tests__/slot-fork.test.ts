import { describe, it, expect } from 'vitest';

import { isSharedSlotReference, parseCollectionOccurrenceIndex } from '../slot-fork.js';

describe('@airo/shared/media/slot-fork', function packageTests() {
  describe('#isSharedSlotReference', function isSharedSlotReferenceTests() {
    it('returns true when refCount exceeds one', function multipleRefs() {
      expect(isSharedSlotReference(2, 'src/data/trucks.ts:4', 'src/data/trucks.ts:4')).toBe(true);
    });

    it('returns true when click sourceRef differs from manifest sourceRef', function sourceRefMismatch() {
      expect(isSharedSlotReference(1, 'src/pages/home.tsx:12', 'src/data/trucks.ts:4')).toBe(true);
    });

    it('returns false when refCount is one and sourceRefs match', function singleRef() {
      expect(isSharedSlotReference(1, 'src/pages/home.tsx:12', 'src/pages/home.tsx:12')).toBe(false);
    });

    it('returns false when click sourceRef is missing', function missingClickRef() {
      expect(isSharedSlotReference(1, null, 'src/pages/home.tsx:12')).toBe(false);
      expect(isSharedSlotReference(1, '', 'src/pages/home.tsx:12')).toBe(false);
    });
  });

  describe('#parseCollectionOccurrenceIndex', function parseCollectionOccurrenceIndexTests() {
    it('parses nth-child from parent segment', function nthChild() {
      const selector = 'html > body > ul > li:nth-child(3) > img:nth-child(1)';
      expect(parseCollectionOccurrenceIndex(selector)).toBe(2);
    });

    it('returns null when selector has no nth-child', function noNthChild() {
      expect(parseCollectionOccurrenceIndex('img.hero-image')).toBeNull();
    });
  });
});
