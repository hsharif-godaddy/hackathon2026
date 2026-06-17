import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../logging/index.js';
import { normalizeAssetPath, resolveFavicon, resolveFaviconHref } from '../asset-paths.js';

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

describe('resolveFaviconHref', () => {
  const assets = [
    { url: 'https://example.com/icon.png', localPath: '.source-site/assets/other/icon.png' },
    { url: 'https://example.com/logo.svg', localPath: '.source-site/assets/images/logo.svg' },
  ];

  it('resolves a matched favicon URL to its public /assets path', () => {
    expect(resolveFaviconHref('https://example.com/icon.png', assets)).toBe('/assets/other/icon.png');
  });

  it('falls back to the source URL when no asset matches (e.g. implicit /favicon.ico)', () => {
    expect(resolveFaviconHref('https://example.com/favicon.ico', assets)).toBe('https://example.com/favicon.ico');
  });

  describe('hotlink-fallback logging', () => {
    afterEach(() => vi.restoreAllMocks());

    it('logs a debug line when no local asset matches (URL-skew observability)', () => {
      const spy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      resolveFaviconHref('https://example.com/favicon.ico', assets);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not log when the favicon resolves to a local asset', () => {
      const spy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      resolveFaviconHref('https://example.com/icon.png', assets);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('resolveFavicon', () => {
  const assets = [
    { url: 'https://example.com/icon.png', localPath: '.source-site/assets/other/icon.png' },
  ];

  it('resolves href to the public path and carries through optional attrs', () => {
    expect(resolveFavicon(
      { url: 'https://example.com/icon.png', rel: 'apple-touch-icon', sizes: '180x180', mimeType: 'image/png' },
      assets,
    )).toEqual({ href: '/assets/other/icon.png', rel: 'apple-touch-icon', sizes: '180x180', mimeType: 'image/png' });
  });

  it('omits absent optional attrs and hotlinks an unmatched url', () => {
    expect(resolveFavicon({ url: 'https://example.com/favicon.ico' }, assets))
      .toEqual({ href: 'https://example.com/favicon.ico' });
  });
});
