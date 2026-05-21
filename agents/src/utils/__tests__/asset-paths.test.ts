import { describe, expect, it } from 'vitest';

import { normalizeAssetPath } from '../asset-paths.js';

describe('normalizeAssetPath', () => {
  it('rewrites .source-site/assets/ prefix to public /assets/', () => {
    expect(normalizeAssetPath('.source-site/assets/images/logo.jpg')).toBe('/assets/images/logo.jpg');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeAssetPath('.source-site\\assets\\images\\logo.jpg')).toBe('/assets/images/logo.jpg');
  });

  it('leaves already-public paths unchanged', () => {
    expect(normalizeAssetPath('/assets/images/logo.jpg')).toBe('/assets/images/logo.jpg');
  });

  it('only replaces the prefix, not other occurrences in the path', () => {
    expect(normalizeAssetPath('.source-site/assets/.source-site/assets/x.jpg')).toBe('/assets/.source-site/assets/x.jpg');
  });
});
