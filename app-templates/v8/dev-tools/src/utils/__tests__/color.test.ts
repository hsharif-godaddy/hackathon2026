import { describe, it, expect } from 'vitest';
import {
  hsvToRgb,
  rgbToHex,
  hexToRgb,
  rgbToHsv,
  hsvToHex,
  hexToHsv,
  isValidHex,
  normalizeHex,
} from '../color';

describe('color-math', () => {
  describe('hsvToRgb', () => {
    it('converts pure red (h=0, s=1, v=1)', () => {
      expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    });

    it('converts pure green (h=120, s=1, v=1)', () => {
      expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]);
    });

    it('converts pure blue (h=240, s=1, v=1)', () => {
      expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255]);
    });

    it('converts black (v=0)', () => {
      expect(hsvToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    });

    it('converts white (s=0, v=1)', () => {
      expect(hsvToRgb(0, 0, 1)).toEqual([255, 255, 255]);
    });

    it('converts mid-gray (s=0, v=0.5)', () => {
      const [r, g, b] = hsvToRgb(0, 0, 0.5);
      expect(r).toBe(128);
      expect(g).toBe(128);
      expect(b).toBe(128);
    });
  });

  describe('rgbToHex', () => {
    it('converts red to #ff0000', () => {
      expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    });

    it('converts black to #000000', () => {
      expect(rgbToHex(0, 0, 0)).toBe('#000000');
    });

    it('pads single-digit hex values', () => {
      expect(rgbToHex(1, 2, 3)).toBe('#010203');
    });
  });

  describe('hexToRgb', () => {
    it('parses #ff0000', () => {
      expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    });

    it('parses #000000', () => {
      expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    });

    it('returns null for invalid hex', () => {
      expect(hexToRgb('not-a-color')).toBeNull();
    });

    it('parses shorthand #f00', () => {
      expect(hexToRgb('#f00')).toEqual([255, 0, 0]);
    });
  });

  describe('rgbToHsv', () => {
    it('converts pure red', () => {
      const { h, s, v } = rgbToHsv(255, 0, 0);
      expect(h).toBe(0);
      expect(s).toBe(1);
      expect(v).toBe(1);
    });

    it('converts white', () => {
      const { h, s, v } = rgbToHsv(255, 255, 255);
      expect(h).toBe(0);
      expect(s).toBe(0);
      expect(v).toBe(1);
    });

    it('converts black', () => {
      const { h, s, v } = rgbToHsv(0, 0, 0);
      expect(h).toBe(0);
      expect(s).toBe(0);
      expect(v).toBe(0);
    });
  });

  describe('round-trip conversions', () => {
    const cases = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#3b82f6', '#f59e0b'];

    for (const hex of cases) {
      it(`hex → hsv → hex preserves ${hex}`, () => {
        const hsv = hexToHsv(hex);
        const result = hsvToHex(hsv.h, hsv.s, hsv.v);
        expect(result).toBe(hex);
      });
    }
  });

  describe('isValidHex', () => {
    it('accepts 6-char with hash', () => {
      expect(isValidHex('#ff0000')).toBe(true);
    });

    it('accepts 3-char with hash', () => {
      expect(isValidHex('#f00')).toBe(true);
    });

    it('accepts without hash', () => {
      expect(isValidHex('ff0000')).toBe(true);
    });

    it('rejects invalid strings', () => {
      expect(isValidHex('xyz')).toBe(false);
      expect(isValidHex('#gg0000')).toBe(false);
      expect(isValidHex('')).toBe(false);
    });
  });

  describe('normalizeHex', () => {
    it('normalizes shorthand to 6-char lowercase with hash', () => {
      expect(normalizeHex('#F00')).toBe('#ff0000');
    });

    it('adds missing hash', () => {
      expect(normalizeHex('3b82f6')).toBe('#3b82f6');
    });

    it('lowercases', () => {
      expect(normalizeHex('#3B82F6')).toBe('#3b82f6');
    });

    it('returns null for invalid input', () => {
      expect(normalizeHex('nope')).toBeNull();
    });
  });
});
