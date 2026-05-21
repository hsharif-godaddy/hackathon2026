import { describe, expect, it } from 'vitest';

import { detectInteractivePatterns } from '../interactive-pattern-detector.js';

describe('detectInteractivePatterns', () => {
  it('returns no patterns for undefined or empty html', () => {
    expect(detectInteractivePatterns(undefined)).toEqual([]);
    expect(detectInteractivePatterns('')).toEqual([]);
  });

  it('returns no patterns for plain content with no carousel/form markers', () => {
    const html = '<html><body><h1>Hello</h1><p>World</p></body></html>';
    expect(detectInteractivePatterns(html)).toEqual([]);
  });

  describe('carousel detection', () => {
    it('detects Swiper carousel', () => {
      const html = '<div class="swiper-container"><div class="swiper-wrapper"></div></div>';
      const result = detectInteractivePatterns(html);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('carousel');
      expect(result[0]?.occurrences).toBeGreaterThanOrEqual(1);
    });

    it('detects Wix Pro Gallery (real-world Urban Cookies markup)', () => {
      const html = '<div class="w02eM9 comp-lehn7wcy wixui-gallery"><img src="/a.jpg" /></div>';
      const result = detectInteractivePatterns(html);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('carousel');
    });

    it('detects Slick carousel', () => {
      const html = '<div class="slick-slider"><div class="slick-track"></div></div>';
      expect(detectInteractivePatterns(html)[0]?.type).toBe('carousel');
    });

    it('detects swiper-container web component element', () => {
      const html = '<swiper-container><swiper-slide>Slide</swiper-slide></swiper-container>';
      expect(detectInteractivePatterns(html)[0]?.type).toBe('carousel');
    });

    it('truncates evidence to 80 characters', () => {
      const longClass = 'a'.repeat(200);
      const html = `<div class="${longClass} swiper-container">x</div>`;
      const result = detectInteractivePatterns(html);
      expect(result[0]?.evidence.length).toBeLessThanOrEqual(80);
    });
  });

  describe('accordion detection', () => {
    it('requires at least 2 accordion markers (avoids false positives on single nav-collapse)', () => {
      const single = '<div class="accordion">one</div>';
      expect(detectInteractivePatterns(single)).toEqual([]);

      const multiple = '<div class="accordion">a</div><div class="accordion">b</div>';
      const result = detectInteractivePatterns(multiple);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('accordion');
      expect(result[0]?.occurrences).toBe(2);
    });

    it('detects multiple <details> elements as accordion', () => {
      const html = '<details>a</details><details>b</details><details>c</details>';
      const result = detectInteractivePatterns(html);
      expect(result[0]?.type).toBe('accordion');
      expect(result[0]?.occurrences).toBe(3);
    });
  });

  describe('tabs detection', () => {
    it('detects ARIA tablist', () => {
      const html = '<div role="tablist"><button role="tab">One</button></div>';
      expect(detectInteractivePatterns(html)[0]?.type).toBe('tabs');
    });
  });

  describe('video-hero detection', () => {
    it('detects autoplay video element', () => {
      const html = '<video autoplay muted loop><source src="/hero.mp4" /></video>';
      expect(detectInteractivePatterns(html)[0]?.type).toBe('video-hero');
    });
  });

  describe('multiple patterns on one page', () => {
    it('returns all detected pattern types independently', () => {
      const html = `
        <div class="swiper-container">slides</div>
        <div role="tablist"><button role="tab">One</button></div>
        <video autoplay><source src="/h.mp4" /></video>
      `;
      const result = detectInteractivePatterns(html);
      const types = result.map(p => p.type).sort();
      expect(types).toEqual(['carousel', 'tabs', 'video-hero']);
    });

    it('sums occurrences across patterns within a single rule', () => {
      const html =
        '<div class="swiper-container">a</div>' +
        '<div data-swiper-id="x">b</div>' +
        '<div class="slick-slider">c</div>';
      const carousel = detectInteractivePatterns(html).find(p => p.type === 'carousel');
      expect(carousel?.occurrences).toBeGreaterThanOrEqual(3);
    });
  });
});
