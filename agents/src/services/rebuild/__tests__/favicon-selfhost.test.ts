import { describe, expect, it, vi } from 'vitest';

import type { SiteFavicon } from '../../../types/rebuild.js';
import {
  faviconMimeType,
  INDEX_HTML_PATH,
  PUBLIC_FAVICON_PATH,
  selfHostFavicon,
  setFaviconLinkType,
} from '../favicon-selfhost.js';

const STOCK_INDEX_HTML: string =
  '<!doctype html>\n<html>\n  <head>\n    <link rel="icon" type="image/svg+xml" href="/favicon.ico" />\n  </head>\n</html>';

describe('faviconMimeType', () => {
  it('prefers an explicit, well-formed favicon mimeType', () => {
    expect(faviconMimeType({ url: 'x', mimeType: 'image/png' }, '.source-site/assets/other/a.ico')).toBe('image/png');
  });

  it('falls back to the downloaded asset extension when mimeType is absent', () => {
    expect(faviconMimeType({ url: 'x' }, '.source-site/assets/other/a.png')).toBe('image/png');
    expect(faviconMimeType({ url: 'x' }, '.source-site/assets/other/a.svg')).toBe('image/svg+xml');
    expect(faviconMimeType({ url: 'x' }, '.source-site/assets/other/a.ico')).toBe('image/x-icon');
  });

  it('ignores a hostile mimeType and falls back to the extension', () => {
    const hostile: SiteFavicon = { url: 'x', mimeType: 'image/png"><script>alert(1)</script>' };
    expect(faviconMimeType(hostile, '.source-site/assets/other/a.png')).toBe('image/png');
  });

  it('returns null when neither mimeType nor extension is recognized', () => {
    expect(faviconMimeType({ url: 'x' }, '.source-site/assets/other/a.bin')).toBeNull();
  });
});

describe('setFaviconLinkType', () => {
  it('rewrites the type of the /favicon.ico icon link', () => {
    const out: string = setFaviconLinkType(STOCK_INDEX_HTML, 'image/png');
    expect(out).toContain('<link rel="icon" type="image/png" href="/favicon.ico" />');
  });

  it('returns the html unchanged when the type already matches', () => {
    const out: string = setFaviconLinkType(STOCK_INDEX_HTML, 'image/svg+xml');
    expect(out).toBe(STOCK_INDEX_HTML);
  });

  it('leaves html untouched when there is no /favicon.ico icon link', () => {
    const html: string = '<head><link rel="icon" href="/assets/other/x.png" /></head>';
    expect(setFaviconLinkType(html, 'image/png')).toBe(html);
  });
});

describe('selfHostFavicon', () => {
  const appPath: string = '/app';
  const assets: ReadonlyArray<{ url: string; localPath: string }> = [
    { url: 'https://example.com/logo.png', localPath: '.source-site/assets/images/logo.png' },
    { url: 'https://example.com/icon.png', localPath: '.source-site/assets/other/abc123.png' },
  ];

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      assets,
      appPath,
      readFaviconBytes: vi.fn(async (): Promise<Buffer> => Buffer.from('PNGBYTES')),
      readWorkspaceText: vi.fn(async (): Promise<string | null> => STOCK_INDEX_HTML),
      writeWorkspaceFile: vi.fn(async (): Promise<void> => undefined),
      ...overrides,
    };
  }

  it('writes the source favicon bytes and corrects the index.html link type', async () => {
    const favicon: SiteFavicon = { url: 'https://example.com/icon.png', rel: 'apple-touch-icon', sizes: '180x180' };
    const d = deps();

    const result = await selfHostFavicon({ favicon, ...d });

    expect(result.faviconWritten).toBe(true);
    expect(result.linkTypeUpdated).toBe(true);
    expect(d.readFaviconBytes).toHaveBeenCalledWith('/app/.source-site/assets/other/abc123.png');
    expect(d.writeWorkspaceFile).toHaveBeenCalledWith(PUBLIC_FAVICON_PATH, 'UE5HQllURVM=', 'base64');
    expect(d.writeWorkspaceFile).toHaveBeenCalledWith(
      INDEX_HTML_PATH,
      expect.stringContaining('<link rel="icon" type="image/png" href="/favicon.ico" />'),
      'utf-8',
    );
  });

  it('writes the favicon but leaves index.html alone when the type already matches (SVG)', async () => {
    const favicon: SiteFavicon = { url: 'https://example.com/icon.svg' };
    const svgAssets: ReadonlyArray<{ url: string; localPath: string }> = [
      { url: 'https://example.com/icon.svg', localPath: '.source-site/assets/other/abc123.svg' },
    ];
    const d = deps({ assets: svgAssets });

    const result = await selfHostFavicon({ favicon, ...d });

    expect(result.faviconWritten).toBe(true);
    expect(result.linkTypeUpdated).toBe(false);
    expect(d.writeWorkspaceFile).toHaveBeenCalledWith(PUBLIC_FAVICON_PATH, expect.any(String), 'base64');
    expect(d.writeWorkspaceFile).not.toHaveBeenCalledWith(INDEX_HTML_PATH, expect.anything(), expect.anything());
  });

  it('does not write when the source metadata has no favicon', async () => {
    const d = deps();
    const result = await selfHostFavicon({ favicon: undefined, ...d });
    expect(result.faviconWritten).toBe(false);
    expect(d.writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it('does not write when the favicon was only hotlinked (no downloaded asset)', async () => {
    const d = deps();
    const result = await selfHostFavicon({ favicon: { url: 'https://example.com/favicon.ico' }, ...d });
    expect(result.faviconWritten).toBe(false);
    expect(d.writeWorkspaceFile).not.toHaveBeenCalled();
  });
});
