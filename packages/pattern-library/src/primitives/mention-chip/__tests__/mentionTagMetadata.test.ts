import { describe, expect, it } from 'vitest';

import {
  getMentionTagIcon,
  getMentionTagLabel,
  MENTION_TAG_DEFAULT_ICON,
  MENTION_TAG_ICONS,
  MENTION_TAG_LABELS,
} from '../mentionTagMetadata';

describe('mentionTagMetadata', function mentionTagMetadataTests() {
  describe('#getMentionTagLabel', function labelTests() {
    it('returns mapped label for known tags', function knownTags() {
      expect(getMentionTagLabel('h1')).toBe('Title');
      expect(getMentionTagLabel('button')).toBe('Button');
    });

    it('normalizes tag casing', function casing() {
      expect(getMentionTagLabel('BUTTON')).toBe('Button');
    });

    it('falls back to raw tag name when unmapped', function fallback() {
      expect(getMentionTagLabel('article')).toBe('article');
    });
  });

  describe('#getMentionTagIcon', function iconTests() {
    it('returns mapped icon for known tags', function knownTags() {
      expect(getMentionTagIcon('p')).toBe('text-highlight');
      expect(getMentionTagIcon('button')).toBe('create-button');
    });

    it('normalizes tag casing', function casing() {
      expect(getMentionTagIcon('IMG')).toBe('image');
    });

    it('falls back to default icon when unmapped', function fallback() {
      expect(getMentionTagIcon('div')).toBe(MENTION_TAG_DEFAULT_ICON);
    });
  });

  describe('exports', function exportsTests() {
    it('exposes label and icon maps', function maps() {
      expect(MENTION_TAG_LABELS.p).toBe('Text');
      expect(MENTION_TAG_ICONS.p).toBe('text-highlight');
    });
  });
});
