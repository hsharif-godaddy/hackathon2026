import { describe, expect, it } from 'vitest';

import {
  CANONICAL_BREAKPOINTS,
  DEFAULT_DESKTOP_DEVICE,
  DEFAULT_MOBILE_DEVICE,
  DEFAULT_TABLET_DEVICE,
  getDevicePreset,
  getDevicesByCategory,
  isCanonicalDevice,
  isFullWidthDevice,
  resolveCanonicalDeviceId,
} from '@/app/[market]/develop/components/preview/devicePresets';
import { PreviewViewMode } from '@/app/[market]/develop/components/types';

describe('devicePresets', function devicePresetsTests() {
  describe('#getDevicePreset', function getDevicePresetTests() {
    it('should resolve canonical presets before detailed presets', function canonicalFirst() {
      expect(getDevicePreset('desktop')?.width).toBe(0);
      expect(getDevicePreset('mobile')?.width).toBe(390);
      expect(getDevicePreset('tablet')?.width).toBe(768);
    });

    it('should resolve detailed presets by id', function detailedPreset() {
      expect(getDevicePreset('iphone-se')?.name).toBe('iPhone SE');
      expect(getDevicePreset('full')?.width).toBe(0);
    });

    it('should return undefined for unknown ids', function unknownId() {
      expect(getDevicePreset('unknown-device')).toBeUndefined();
    });
  });

  describe('#getDevicesByCategory', function getDevicesByCategoryTests() {
    it('should list canonical breakpoint first in each category', function canonicalFirstInCategory() {
      expect(getDevicesByCategory(PreviewViewMode.MOBILE)[0]?.id).toBe('mobile');
      expect(getDevicesByCategory(PreviewViewMode.TABLET)[0]?.id).toBe('tablet');
      expect(getDevicesByCategory(PreviewViewMode.DESKTOP)[0]?.id).toBe('desktop');
    });
  });

  describe('#isCanonicalDevice', function isCanonicalDeviceTests() {
    it('should identify canonical ids only', function canonicalIds() {
      expect(isCanonicalDevice('mobile')).toBe(true);
      expect(isCanonicalDevice('iphone-se')).toBe(false);
    });
  });

  describe('#resolveCanonicalDeviceId', function resolveCanonicalDeviceIdTests() {
    it('should map legacy full and detailed presets to category canonical ids', function legacyMapping() {
      expect(resolveCanonicalDeviceId('full')).toBe('desktop');
      expect(resolveCanonicalDeviceId('iphone-se')).toBe('mobile');
      expect(resolveCanonicalDeviceId('ipad')).toBe('tablet');
    });

    it('should return desktop canonical id for unknown ids', function unknownFallback() {
      expect(resolveCanonicalDeviceId('does-not-exist')).toBe('desktop');
    });

    it('should pass through canonical ids unchanged', function passthrough() {
      for (const preset of CANONICAL_BREAKPOINTS) {
        expect(resolveCanonicalDeviceId(preset.id)).toBe(preset.id);
      }
    });
  });

  describe('#isFullWidthDevice', function isFullWidthDeviceTests() {
    it('should treat zero-dimension presets as full width', function fullWidth() {
      expect(isFullWidthDevice('desktop')).toBe(true);
      expect(isFullWidthDevice('full')).toBe(true);
    });

    it('should treat fixed-dimension presets as framed', function framed() {
      expect(isFullWidthDevice('mobile')).toBe(false);
      expect(isFullWidthDevice('iphone-se')).toBe(false);
    });
  });

  describe('defaults', function defaultsTests() {
    it('should expose canonical ids as mode defaults', function canonicalDefaults() {
      expect(DEFAULT_DESKTOP_DEVICE).toBe('desktop');
      expect(DEFAULT_MOBILE_DEVICE).toBe('mobile');
      expect(DEFAULT_TABLET_DEVICE).toBe('tablet');
    });
  });
});
