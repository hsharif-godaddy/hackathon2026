/**
 * The build prompt's asset section must surface Atlas placement (where each image
 * sat on the source page) so the develop agent can rebuild each section with its
 * real image — not bucket images by pixel size alone. See categorizeAssets in
 * user-prompt-builder.ts.
 */
import { describe, expect, it } from 'vitest';

import { categorizeAssets } from '../user-prompt-builder.js';
import type { AssetInfo } from '../../../types/rebuild.js';

const img = (localPath: string, placement: AssetInfo['placement'], dims = { width: 1200, height: 1200 }): AssetInfo => ({
  url: `https://example.com/${localPath}`,
  localPath: `.source-site/assets/images/${localPath}`,
  type: 'image',
  sourcePages: ['https://example.com/'],
  dimensions: dims,
  ...(placement ? { placement } : {}),
});

describe('categorizeAssets — placement-aware bucketing', () => {
  const assets: AssetInfo[] = [
    img('logo.png', { inHeader: true, inFooter: false, inFirstSection: false, nearH1: false, isFirstInContainer: true }, { width: 600, height: 46 }),
    img('hero.jpg', { inHeader: false, inFooter: false, inFirstSection: true, nearH1: true, isFirstInContainer: true }, { width: 1600, height: 900 }),
    img('classes.jpg', { inHeader: false, inFooter: false, inFirstSection: false, nearH1: false, isFirstInContainer: true, linkedTo: 'https://example.com/classes' }),
    img('footer.png', { inHeader: false, inFooter: true, inFirstSection: false, nearH1: false, isFirstInContainer: false }, { width: 200, height: 80 }),
    img('bg-art.jpg', undefined, { width: 1920, height: 1080 }),
  ];
  const out = categorizeAssets(assets);

  it('groups images by source-page section, not just pixel size', () => {
    expect(out).toContain('Header');
    expect(out).toContain('Hero / Top of Page');
    expect(out).toContain('Footer');
  });

  it('surfaces the card link target so the agent uses the right image for that nav/card', () => {
    expect(out).toContain('links to /classes');
    expect(out).toContain('/assets/images/classes.jpg');
  });

  it('falls back to a size bucket for images with no captured placement', () => {
    expect(out).toMatch(/placement unknown/i);
    expect(out).toContain('/assets/images/bg-art.jpg');
  });

  it('places the header image under Header, not a content bucket', () => {
    const headerIdx = out.indexOf('Header');
    const heroIdx = out.indexOf('Hero / Top of Page');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(out.slice(headerIdx, heroIdx >= 0 ? heroIdx : undefined)).toContain('/assets/images/logo.png');
  });
});
