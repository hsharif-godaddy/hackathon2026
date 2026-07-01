import { describe, expect, it } from 'vitest';

import { shouldRejectEmptyBinaryCreate } from '../file-edit-utils.js';

describe('file-edit-utils', function fileEditUtilsTests() {
  describe('#shouldRejectEmptyBinaryCreate', function shouldRejectEmptyBinaryCreateTests() {
    it('returns true for raster image paths', function rasterImage() {
      expect(shouldRejectEmptyBinaryCreate('public/assets/logo.png')).toBe(true);
      expect(shouldRejectEmptyBinaryCreate('public/assets/LOGO.PNG')).toBe(true);
      expect(shouldRejectEmptyBinaryCreate('public/assets/photo.jpg')).toBe(true);
      expect(shouldRejectEmptyBinaryCreate('public/assets/icon.webp')).toBe(true);
    });

    it('returns true for other binary paths excluding svg', function otherBinary() {
      expect(shouldRejectEmptyBinaryCreate('public/assets/brochure.pdf')).toBe(true);
      expect(shouldRejectEmptyBinaryCreate('public/fonts/logo.woff2')).toBe(true);
    });

    it('returns false for svg logos resolved as text', function svgText() {
      expect(shouldRejectEmptyBinaryCreate('public/assets/logo.svg')).toBe(false);
    });

    it('returns false for source and data files', function textFiles() {
      expect(shouldRejectEmptyBinaryCreate('src/App.tsx')).toBe(false);
      expect(shouldRejectEmptyBinaryCreate('public/data/config.json')).toBe(false);
      expect(shouldRejectEmptyBinaryCreate('public/assets/logo')).toBe(false);
    });
  });
});
