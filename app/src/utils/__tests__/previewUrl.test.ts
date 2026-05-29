import { AIRO_PREVIEW_PARAM, withPreviewParam } from '../previewUrl';

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
});
