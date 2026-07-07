import { describe, expect, it } from 'vitest';

import {
  formatCarouselSlideImageLabel,
  formatMediaPanelSlotTitle,
  formatSlotName,
} from '@/app/[market]/develop/components/media/mediaSlotLabels';

describe('mediaSlotLabels', () => {
  describe('formatCarouselSlideImageLabel', () => {
    it('maps forked hero slots to slide image labels', () => {
      expect(formatCarouselSlideImageLabel('pages/home/hero-4')).toBe('Slide Image 4');
      expect(formatCarouselSlideImageLabel('pages/home/hero-1')).toBe('Slide Image 1');
    });

    it('returns null for slots without a numeric fork suffix', () => {
      expect(formatCarouselSlideImageLabel('pages/home/hero')).toBeNull();
    });
  });

  describe('formatMediaPanelSlotTitle', () => {
    it('uses slide image labels during preview replace', () => {
      expect(formatMediaPanelSlotTitle('pages/home/hero-4', { fromPreviewReplace: true }))
        .toBe('Slide Image 4');
    });

    it('keeps default slot labels outside preview replace', () => {
      expect(formatMediaPanelSlotTitle('pages/home/hero-4')).toBe('Home Hero 4');
    });

    it('falls back to formatSlotName for non-carousel slots', () => {
      expect(formatMediaPanelSlotTitle('pages/home/hero', { fromPreviewReplace: true }))
        .toBe(formatSlotName('pages/home/hero'));
    });
  });
});
