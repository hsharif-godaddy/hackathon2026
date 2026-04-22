import { describe, expect, it } from 'vitest';

import { parseScreenshotDataUrl, screenshotFilenameForMime } from '../screenshot-data-url.js';

const ONE_BY_ONE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('screenshot-data-url', () => {
  describe('#parseScreenshotDataUrl', () => {
    it('parses PNG data URLs with correct mime', () => {
      const input = `data:image/png;base64,${ONE_BY_ONE_PNG_B64}`;
      const out = parseScreenshotDataUrl(input);
      expect(out).not.toBeNull();
      expect(out!.mimeType).toBe('image/png');
      expect(out!.buffer.length).toBeGreaterThan(0);
    });

    it('parses JPEG data URLs', () => {
      const jpegB64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
      const input = `data:image/jpeg;base64,${jpegB64}`;
      const out = parseScreenshotDataUrl(input);
      expect(out).not.toBeNull();
      expect(out!.mimeType).toBe('image/jpeg');
    });

    it('returns null for unsupported image subtypes to avoid mis-sniffed attachments', () => {
      expect(parseScreenshotDataUrl(`data:image/avif;base64,${ONE_BY_ONE_PNG_B64}`)).toBeNull();
      expect(parseScreenshotDataUrl(`data:image/heic;base64,${ONE_BY_ONE_PNG_B64}`)).toBeNull();
    });

    it('returns null for invalid payloads', () => {
      expect(parseScreenshotDataUrl('')).toBeNull();
      expect(parseScreenshotDataUrl('data:image/png;base64,')).toBeNull();
      expect(parseScreenshotDataUrl('hello')).toBeNull();
    });
  });

  describe('#screenshotFilenameForMime', () => {
    it('maps mime types to filenames', () => {
      expect(screenshotFilenameForMime('image/png')).toBe('homepage.png');
      expect(screenshotFilenameForMime('image/jpeg')).toBe('homepage.jpg');
      expect(screenshotFilenameForMime('image/webp')).toBe('homepage.webp');
    });
  });
});
