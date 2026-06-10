/**
 * Rebuild-aware media slotting: the matcher that picks a customer's scraped
 * photo for an agent's media slot+query (instead of Getty stock) during the
 * initial build of a rebuilt site. See rebuild-source-media.ts.
 */
import { describe, expect, it } from 'vitest';

import { selectSourceImageForSlot, toServableSlotUrl, tokenize } from '../rebuild-source-media.js';

describe('toServableSlotUrl', () => {
  it('rewrites a public /assets/ path to the uploads form dev-supervisor serves', () => {
    // The image-slot handler serves a local file only when currentUrl is
    // /airo-assets/uploads/{filename}; a bare /assets/ path is rejected.
    expect(toServableSlotUrl('/assets/images/abc123.jpg')).toBe('/airo-assets/uploads/abc123.jpg');
    expect(toServableSlotUrl('/assets/other/font.woff2')).toBe('/airo-assets/uploads/font.woff2');
  });
});

// Mirrors the thefrenchitaliantable.com homepage manifest shape.
const logo = {
  localPath: '.source-site/assets/images/logo.png',
  type: 'image',
  usageContext: 'logo',
  description: "logo text THE FRENCH ITALIAN TABLE green sans-serif",
  dimensions: { width: 605, height: 46 },
};
const heroGraphic = {
  localPath: '.source-site/assets/images/hero-text.png',
  type: 'image',
  usageContext: 'hero',
  description: 'large light yellow text on white background title heading',
  dimensions: { width: 1027, height: 480 },
};
const foodFlatlay = {
  localPath: '.source-site/assets/images/food.jpg',
  type: 'image',
  usageContext: 'content',
  description: 'overhead flat-lay restaurant dining table plated pasta dishes wooden surface',
  dimensions: { width: 1720, height: 1720 },
};
const chefs = {
  localPath: '.source-site/assets/images/chefs.jpg',
  type: 'image',
  usageContext: 'profile',
  description: 'two smiling men side by side neutral metallic interior friendly confident',
  dimensions: { width: 1720, height: 1720 },
};
const all = [logo, heroGraphic, foodFlatlay, chefs];

describe('tokenize', () => {
  it('lowercases, drops short tokens and stop-words', () => {
    expect(tokenize('Overhead flat-lay with the PASTA dishes')).toEqual(
      new Set(['overhead', 'flat', 'lay', 'pasta', 'dishes']),
    );
  });
  it('handles empty/nullish', () => {
    expect(tokenize(undefined)).toEqual(new Set());
    expect(tokenize('')).toEqual(new Set());
  });
});

describe('selectSourceImageForSlot', () => {
  it('matches a food query to the food photo by description overlap', () => {
    const pick = selectSourceImageForSlot(all, 'pages/home/gallery-1', 'rustic pasta food spread italian table', new Set());
    expect(pick?.url).toBe('/assets/images/food.jpg');
  });

  it('routes a team/profile slot to the people photo', () => {
    const pick = selectSourceImageForSlot(all, 'pages/home/team-anthony', 'two people cooking class together', new Set());
    expect(pick?.url).toBe('/assets/images/chefs.jpg');
  });

  it('never fills a content slot with the logo', () => {
    for (const slot of ['pages/home/hero', 'pages/home/gallery-1', 'pages/home/feature']) {
      const pick = selectSourceImageForSlot(all, slot, 'anything at all', new Set());
      expect(pick?.url).not.toBe('/assets/images/logo.png');
    }
  });

  it('fills a logo slot only from logo-role images', () => {
    const pick = selectSourceImageForSlot(all, 'logo/primary', 'brand mark', new Set());
    expect(pick?.url).toBe('/assets/images/logo.png');
  });

  // Prominent slots (hero/banner): the full-bleed image is the biggest real photo.
  // Atlas placement covers only the small lazy-load DOM placeholders here, so size
  // must dominate — otherwise a placeholder or a text-matched smaller photo wins.
  describe('prominent slots prefer the biggest real photo', () => {
    const bigFood = {
      localPath: '.source-site/assets/images/big-food.jpg', type: 'image', usageContext: 'content',
      description: 'overhead table with pasta dishes', dimensions: { width: 1720, height: 1720 },
    };
    const mediumChefs = {
      localPath: '.source-site/assets/images/chefs.jpg', type: 'image', usageContext: 'content',
      description: 'two chefs cooking pasta in a kitchen', dimensions: { width: 864, height: 864 },
    };
    const placeholder = {
      localPath: '.source-site/assets/images/ph.jpg', type: 'image', usageContext: null, description: '',
      dimensions: { width: 592, height: 592 },
      placement: { inFirstSection: true, nearH1: true, inHeader: false, inFooter: false, isFirstInContainer: true },
    };

    it('picks the large described image over a small first-section placeholder for the hero', () => {
      const pick = selectSourceImageForSlot([placeholder, bigFood], 'pages/home/hero', 'kitchen', new Set());
      expect(pick?.url).toBe('/assets/images/big-food.jpg');
    });

    it('lets image size win the hero over a smaller image with a stronger text match', () => {
      const pick = selectSourceImageForSlot([bigFood, mediumChefs], 'pages/home/hero', 'two chefs cooking pasta in a kitchen', new Set());
      expect(pick?.url).toBe('/assets/images/big-food.jpg');
    });

    it('does NOT force the biggest image on a non-prominent gallery slot (text still decides)', () => {
      const pick = selectSourceImageForSlot([bigFood, mediumChefs], 'pages/home/gallery-3', 'two chefs cooking pasta in a kitchen', new Set());
      expect(pick?.url).toBe('/assets/images/chefs.jpg');
    });
  });

  it('skips images already used by other slots (dedup across the page)', () => {
    const used = new Set(['/assets/images/food.jpg']);
    const pick = selectSourceImageForSlot(all, 'pages/home/gallery-2', 'pasta dishes table', used);
    expect(pick?.url).not.toBe('/assets/images/food.jpg');
    expect(pick?.url).toBeDefined();
  });

  it('still returns a real photo (largest unused) when nothing matches — never null with candidates left', () => {
    const pick = selectSourceImageForSlot(all, 'pages/home/section', 'zzz qqq xyzzy', new Set());
    expect(pick).not.toBeNull();
    // a content photo, not the logo
    expect(pick?.url).not.toBe('/assets/images/logo.png');
  });

  it('exposes the other photos as swappable alternatives', () => {
    const pick = selectSourceImageForSlot(all, 'pages/home/gallery-1', 'pasta', new Set());
    expect(pick?.alternatives.length).toBeGreaterThan(0);
    expect(pick?.alternatives).not.toContain(pick?.url);
  });

  it('returns null when no candidates remain after the used filter', () => {
    expect(selectSourceImageForSlot([], 'pages/home/hero', 'x', new Set())).toBeNull();
    const allUsed = new Set(all.map(a => a.localPath.replace('.source-site/assets/', '/assets/')));
    expect(selectSourceImageForSlot(all, 'pages/home/hero', 'x', allUsed)).toBeNull();
  });
});

describe('selectSourceImageForSlot — placement (Atlas SSM) signals', () => {
  const heroPhoto = {
    localPath: '.source-site/assets/images/hero-photo.jpg',
    type: 'image',
    description: 'plated dish on a table',
    dimensions: { width: 1600, height: 900 },
    placement: { inFirstSection: true, nearH1: true, isFirstInContainer: true },
  };
  const classesCard = {
    localPath: '.source-site/assets/images/classes-card.jpg',
    type: 'image',
    description: 'people in a room',
    dimensions: { width: 800, height: 800 },
    placement: { linkedTo: 'https://thefrenchitaliantable.com/classes', isFirstInContainer: true },
  };
  const bodyPhoto = {
    localPath: '.source-site/assets/images/body.jpg',
    type: 'image',
    description: 'plated dish on a table close up',
    dimensions: { width: 1200, height: 1200 },
    placement: { isFirstInContainer: true },
  };
  const headerLogo = {
    localPath: '.source-site/assets/images/header-logo.png',
    type: 'image',
    description: 'brand wordmark',
    dimensions: { width: 600, height: 46 },
    placement: { inHeader: true },
  };
  const pool = [heroPhoto, classesCard, bodyPhoto, headerLogo];

  it('routes the hero slot to the image that sat in the first section / near H1', () => {
    // bodyPhoto has the same description tokens; placement is the tiebreaker.
    const pick = selectSourceImageForSlot(pool, 'pages/home/hero', 'plated dish table', new Set());
    expect(pick?.url).toBe('/assets/images/hero-photo.jpg');
  });

  it('matches a named card slot to the image that linked to that page', () => {
    const pick = selectSourceImageForSlot(pool, 'pages/home/classes-card', 'learn cooking', new Set());
    expect(pick?.url).toBe('/assets/images/classes-card.jpg');
  });

  it('treats an in-header image as a logo: excluded from content slots', () => {
    const pick = selectSourceImageForSlot(pool, 'pages/home/gallery-1', 'brand wordmark', new Set());
    expect(pick?.url).not.toBe('/assets/images/header-logo.png');
  });

  it('fills a logo slot from the in-header image even without a vision usageContext', () => {
    const pick = selectSourceImageForSlot(pool, 'logo/primary', 'logo', new Set());
    expect(pick?.url).toBe('/assets/images/header-logo.png');
  });
});
