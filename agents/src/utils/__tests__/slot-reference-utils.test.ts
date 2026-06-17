import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildForkedSlotPath,
  countSlotUrlReferences,
  imageSlotUrl,
  isSharedSlotReference,
  parseCollectionOccurrenceIndex,
  parseImageSlotPath,
} from '../slot-reference-utils.js';

describe('slot-reference-utils', function packageTests() {
  describe('#imageSlotUrl', function imageSlotUrlTests() {
    it('builds the preview slot URL prefix', function builds() {
      expect(imageSlotUrl('pages/home/hero')).toBe('/airo-assets/images/pages/home/hero');
    });
  });

  describe('#parseImageSlotPath', function parseImageSlotPathTests() {
    it('extracts slot path from relative URLs', function relative() {
      expect(parseImageSlotPath('/airo-assets/images/pages/home/hero')).toBe('pages/home/hero');
    });

    it('extracts slot path from absolute browser URLs', function absolute() {
      expect(parseImageSlotPath('https://preview.example.com/airo-assets/images/pages/home/hero?v=1'))
        .toBe('pages/home/hero');
    });

    it('returns null for upload URLs', function upload() {
      expect(parseImageSlotPath('/airo-assets/uploads/abc.jpg')).toBeNull();
    });
  });

  describe('#isSharedSlotReference', function isSharedSlotReferenceTests() {
    it('detects multiple source references', function multipleRefs() {
      expect(isSharedSlotReference(2, 'src/data/trucks.ts:4', 'src/data/trucks.ts:4')).toBe(true);
    });

    it('detects sourceRef mismatch', function sourceRefMismatch() {
      expect(isSharedSlotReference(1, 'src/pages/home.tsx:12', 'src/data/trucks.ts:4')).toBe(true);
    });

    it('returns false for a unique slot', function unique() {
      expect(isSharedSlotReference(1, 'src/pages/home.tsx:12', 'src/pages/home.tsx:12')).toBe(false);
    });

    it('returns false when click sourceRef is missing', function missingClickRef() {
      expect(isSharedSlotReference(1, null, 'src/pages/home.tsx:12')).toBe(false);
    });
  });

  describe('#parseCollectionOccurrenceIndex', function parseCollectionOccurrenceIndexTests() {
    it('returns the parent nth-child index before the target element', function parentIndex() {
      const selector =
        'html:nth-child(1) > body:nth-child(1) > main:nth-child(1) > ul:nth-child(1) > li:nth-child(3) > img:nth-child(1)';
      expect(parseCollectionOccurrenceIndex(selector)).toBe(2);
    });

    it('returns null when selector has no nth-child segments', function noNthChild() {
      expect(parseCollectionOccurrenceIndex('img.hero-image')).toBeNull();
    });
  });

  describe('#buildForkedSlotPath', function buildForkedSlotPathTests() {
    it('appends the next available counter suffix', function counterSuffix() {
      const manifest = {
        'pages/home/hero': {},
        'pages/home/hero-2': {},
      };
      expect(buildForkedSlotPath('pages/home/hero', manifest)).toBe('pages/home/hero-3');
    });
  });

  describe('#countSlotUrlReferences', function countSlotUrlReferencesTests() {
    it('counts slot URL references under src/', async function counts() {
      const root = await mkdtemp(join(tmpdir(), 'slot-ref-count-'));
      try {
        await mkdir(join(root, 'src', 'data'), { recursive: true });
        await writeFile(
          join(root, 'src', 'data', 'trucks.ts'),
          `export const trucks = [
  { image: '${imageSlotUrl('pages/home/featured-truck')}' },
  { image: '${imageSlotUrl('pages/home/featured-truck')}' },
];`
        );

        expect(await countSlotUrlReferences(root, 'pages/home/featured-truck')).toBe(2);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
