import { describe, expect, it } from 'vitest';
import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '../constants.js';
import { getFilenameFromUploadUrl, isSafeUploadFilename } from '../utils.js';

describe('media utils', () => {
  describe('isSafeUploadFilename', () => {
    it('accepts single-segment stored upload filenames', () => {
      expect(isSafeUploadFilename('hero-upload.jpg')).toBe(true);
    });

    it('rejects path traversal and nested paths', () => {
      expect(isSafeUploadFilename('../hero-upload.jpg')).toBe(false);
      expect(isSafeUploadFilename('nested/hero-upload.jpg')).toBe(false);
      expect(isSafeUploadFilename('nested\\hero-upload.jpg')).toBe(false);
      expect(isSafeUploadFilename('bad..jpg')).toBe(false);
      expect(isSafeUploadFilename('bad\0.jpg')).toBe(false);
    });
  });

  describe('getFilenameFromUploadUrl', () => {
    it('extracts the filename from an upload asset URL', () => {
      expect(getFilenameFromUploadUrl(`${AIRO_ASSET_UPLOADS_URL_PREFIX}hero-upload.jpg`)).toBe(
        'hero-upload.jpg'
      );
    });

    it('returns null for unsafe or non-upload URLs', () => {
      expect(getFilenameFromUploadUrl('/assets/hero-upload.jpg')).toBeNull();
      expect(
        getFilenameFromUploadUrl(`${AIRO_ASSET_UPLOADS_URL_PREFIX}nested/hero.jpg`)
      ).toBeNull();
      expect(getFilenameFromUploadUrl(`${AIRO_ASSET_UPLOADS_URL_PREFIX}bad..jpg`)).toBeNull();
    });
  });
});
