import { describe, expect,it } from 'vitest';

import { getContrastColor,getLuminance } from './color';

describe('color utilities', () => {
  describe('getLuminance', () => {
    it('should return 0 for black (#000000)', () => {
      expect(getLuminance('#000000')).toBe(0);
    });

    it('should return 1 for white (#FFFFFF)', () => {
      expect(getLuminance('#FFFFFF')).toBe(1);
    });

    it('should calculate luminance for red', () => {
      const luminance = getLuminance('#FF0000');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
      expect(luminance).toBeCloseTo(0.2126, 4); // Red component weight
    });

    it('should calculate luminance for green', () => {
      const luminance = getLuminance('#00FF00');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
      expect(luminance).toBeCloseTo(0.7152, 4); // Green component weight
    });

    it('should calculate luminance for blue', () => {
      const luminance = getLuminance('#0000FF');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
      expect(luminance).toBeCloseTo(0.0722, 4); // Blue component weight
    });

    it('should calculate luminance for orange (#FF5733)', () => {
      const luminance = getLuminance('#FF5733');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
      expect(luminance).toBeCloseTo(0.2832, 3);
    });

    it('should calculate luminance for light gray (#F0F0F0)', () => {
      const luminance = getLuminance('#F0F0F0');
      expect(luminance).toBeGreaterThan(0.5);
      expect(luminance).toBeLessThan(1);
      expect(luminance).toBeCloseTo(0.8714, 3);
    });

    it('should calculate luminance for dark gray (#333333)', () => {
      const luminance = getLuminance('#333333');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(0.5);
      expect(luminance).toBeCloseTo(0.0331, 3);
    });

    it('should handle lowercase hex colors', () => {
      const upperLuminance = getLuminance('#FF5733');
      const lowerLuminance = getLuminance('#ff5733');
      expect(lowerLuminance).toBeCloseTo(upperLuminance, 4);
    });

    it('should handle different shades of the same hue', () => {
      const light = getLuminance('#FFB3A3');
      const medium = getLuminance('#FF5733');
      const dark = getLuminance('#8B2E19');

      expect(light).toBeGreaterThan(medium);
      expect(medium).toBeGreaterThan(dark);
    });
  });

  describe('getContrastColor', () => {
    it('should return black for white background', () => {
      expect(getContrastColor('#FFFFFF')).toBe('#000000');
    });

    it('should return white for black background', () => {
      expect(getContrastColor('#000000')).toBe('#FFFFFF');
    });

    it('should return white for orange background (#FF5733)', () => {
      expect(getContrastColor('#FF5733')).toBe('#FFFFFF');
    });

    it('should return black for light gray background (#F0F0F0)', () => {
      expect(getContrastColor('#F0F0F0')).toBe('#000000');
    });

    it('should return white for dark gray background (#333333)', () => {
      expect(getContrastColor('#333333')).toBe('#FFFFFF');
    });

    it('should return white for red background', () => {
      expect(getContrastColor('#FF0000')).toBe('#FFFFFF');
    });

    it('should return white for blue background', () => {
      expect(getContrastColor('#0000FF')).toBe('#FFFFFF');
    });

    it('should return black for yellow background', () => {
      expect(getContrastColor('#FFFF00')).toBe('#000000');
    });

    it('should return white for navy background', () => {
      expect(getContrastColor('#000080')).toBe('#FFFFFF');
    });

    it('should handle lowercase hex colors', () => {
      const upperResult = getContrastColor('#FF5733');
      const lowerResult = getContrastColor('#ff5733');
      expect(lowerResult).toBe(upperResult);
    });

    it('should return white for medium luminance colors below threshold', () => {
      // Luminance = 0.5 is the threshold
      // Test a color with luminance just below 0.5
      expect(getContrastColor('#808080')).toBe('#FFFFFF');
    });

    it('should return black for medium luminance colors above threshold', () => {
      // Test a color with luminance above 0.5
      expect(getContrastColor('#BFBFBF')).toBe('#000000');
    });
  });

  describe('integration tests', () => {
    it('should provide consistent contrast recommendations for color palette', () => {
      const colorPalette = [
        { bg: '#1E3A8A', expectedText: '#FFFFFF' }, // Dark blue
        { bg: '#3B82F6', expectedText: '#FFFFFF' }, // Blue
        { bg: '#60A5FA', expectedText: '#FFFFFF' }, // Light blue
        { bg: '#DBEAFE', expectedText: '#000000' }, // Very light blue
        { bg: '#EF4444', expectedText: '#FFFFFF' }, // Red
        { bg: '#10B981', expectedText: '#FFFFFF' }, // Green
        { bg: '#F59E0B', expectedText: '#FFFFFF' }, // Amber
      ];

      colorPalette.forEach(({ bg, expectedText }) => {
        const textColor = getContrastColor(bg);
        expect(textColor).toBe(expectedText);
      });
    });

    it('should calculate luminance values in expected range for all colors', () => {
      const colors = ['#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF'];
      const luminances = colors.map(color => getLuminance(color));

      // Luminance should be monotonically increasing
      for (let i = 1; i < luminances.length; i++) {
        expect(luminances[i]).toBeGreaterThan(luminances[i - 1]);
      }

      // All luminances should be in valid range [0, 1]
      luminances.forEach(luminance => {
        expect(luminance).toBeGreaterThanOrEqual(0);
        expect(luminance).toBeLessThanOrEqual(1);
      });
    });
  });
});
