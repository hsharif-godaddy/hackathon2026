import { describe, expect, it } from 'vitest';

import type { ContentLink } from '../../../types/rebuild.js';
import { buildContentLinksBlock } from '../user-prompt-builder.js';

describe('#buildContentLinksBlock', function buildContentLinksBlockTests() {
  it('returns empty string when contentLinks is undefined', function undefinedInput() {
    expect(buildContentLinksBlock(undefined)).toBe('');
  });

  it('returns empty string when contentLinks is empty', function emptyInput() {
    expect(buildContentLinksBlock([])).toBe('');
  });

  it('annotates external links with (external)', function externalSuffix() {
    const links: ContentLink[] = [
      {
        label: 'Partner brochure',
        url: 'https://cdn.partner.com/brochure.pdf',
        isExternal: true,
      },
    ];

    expect(buildContentLinksBlock(links)).toContain('"Partner brochure" → https://cdn.partner.com/brochure.pdf (external)');
  });

  it('omits (external) for same-origin document links', function internalSuffix() {
    const links: ContentLink[] = [
      {
        label: 'Menu PDF',
        url: 'https://example.com/files/menu.pdf',
        isExternal: false,
      },
    ];

    const block = buildContentLinksBlock(links);
    expect(block).toContain('"Menu PDF" → https://example.com/files/menu.pdf');
    expect(block).not.toContain('(external)');
  });
});
