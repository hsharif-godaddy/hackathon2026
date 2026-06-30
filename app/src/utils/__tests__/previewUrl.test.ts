import { describe, expect, it } from 'vitest';

import { AIRO_PREVIEW_PARAM, withPreviewParam, withPreviewPath } from '../previewUrl';

describe('previewUrl', () => {
  describe('withPreviewParam', () => {
    it('appends param to URL without query string', () => {
      expect(withPreviewParam('https://example.com')).toBe('https://example.com?airoPreview=1');
    });

    it('appends param to URL with existing query string', () => {
      expect(withPreviewParam('https://example.com?foo=bar')).toBe('https://example.com?foo=bar&airoPreview=1');
    });

    it('exports the param name constant', () => {
      expect(AIRO_PREVIEW_PARAM).toBe('airoPreview');
    });
  });

  describe('withPreviewPath', () => {
    it('places path before the share token query string', () => {
      expect(withPreviewPath('https://host.preview.c39.airoapp.ai/?airoShareToken=abc', '/favicon.ico'))
        .toBe('https://host.preview.c39.airoapp.ai/favicon.ico?airoShareToken=abc');
    });

    it('places path before the share token when previewUrl has no trailing slash', () => {
      expect(withPreviewPath('https://host.preview.c39.airoapp.ai?airoShareToken=abc', '/logo.png'))
        .toBe('https://host.preview.c39.airoapp.ai/logo.png?airoShareToken=abc');
    });

    it('works when previewUrl has no query string', () => {
      expect(withPreviewPath('https://host.preview.c39.airoapp.ai', '/images/photo.png'))
        .toBe('https://host.preview.c39.airoapp.ai/images/photo.png');
    });

    it('replaces any existing path segment in previewUrl — only the new path is kept', () => {
      // pathname assignment replaces, not appends; the old segment is intentionally dropped
      expect(withPreviewPath('https://host/old?airoShareToken=abc', '/new.png'))
        .toBe('https://host/new.png?airoShareToken=abc');
    });

    it('throws on a malformed previewUrl', () => {
      expect(() => withPreviewPath('not-a-valid-url', '/path')).toThrow();
    });
  });
});
