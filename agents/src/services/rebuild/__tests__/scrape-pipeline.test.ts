import { describe, expect, it } from 'vitest';

import { bucketAssetsForProcessing } from '../scrape-pipeline.js';

describe('bucketAssetsForProcessing', () => {
  const homePageUrl = 'https://example.com/';

  it('returns empty buckets for empty input', () => {
    const result = bucketAssetsForProcessing([], homePageUrl);
    expect(result.assetMap.size).toBe(0);
    expect(result.homeAssets).toEqual([]);
    expect(result.otherAssets).toEqual([]);
  });

  it('builds an assetMap of url → sourceUrl[] (multi-page references coalesce)', () => {
    const assets = [
      { url: 'https://example.com/logo.png', sourceUrl: 'https://example.com/' },
      { url: 'https://example.com/logo.png', sourceUrl: 'https://example.com/about' },
      { url: 'https://example.com/hero.jpg', sourceUrl: 'https://example.com/' },
    ];
    const { assetMap } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(assetMap.get('https://example.com/logo.png')).toEqual([
      'https://example.com/',
      'https://example.com/about',
    ]);
    expect(assetMap.get('https://example.com/hero.jpg')).toEqual(['https://example.com/']);
  });

  it('splits assets by sourceUrl into home vs other based on homePageUrl', () => {
    const assets = [
      { url: 'a', sourceUrl: 'https://example.com/' },
      { url: 'b', sourceUrl: 'https://example.com/about' },
      { url: 'c', sourceUrl: 'https://example.com/' },
      { url: 'd', sourceUrl: 'https://example.com/contact' },
    ];
    const { homeAssets, otherAssets } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(homeAssets.map(a => a.url)).toEqual(['a', 'c']);
    expect(otherAssets.map(a => a.url)).toEqual(['b', 'd']);
  });

  it('does NOT dedupe within buckets — preserves the asymmetric-dedupe contract', () => {
    // Legacy callers dedupe via dedupeExtractedAssetRows; Atlas callers don't
    // (Atlas adapter already emits a deduped stream). bucketAssetsForProcessing
    // returns raw arrays in BOTH buckets so each caller chooses.
    const assets = [
      { url: 'logo.png', sourceUrl: 'https://example.com/' },
      { url: 'logo.png', sourceUrl: 'https://example.com/' }, // duplicate
      { url: 'about.png', sourceUrl: 'https://example.com/about' },
      { url: 'about.png', sourceUrl: 'https://example.com/about' }, // duplicate
    ];
    const { homeAssets, otherAssets } = bucketAssetsForProcessing(assets, homePageUrl);
    expect(homeAssets).toHaveLength(2); // not deduped
    expect(otherAssets).toHaveLength(2); // not deduped
  });

  it('treats normalized-page-key matches as home — strips trailing slash variations', () => {
    // normalizeRebuildPageKey collapses trailing slash; both should bucket as home.
    const assets = [
      { url: 'a', sourceUrl: 'https://example.com/' },
      { url: 'b', sourceUrl: 'https://example.com' },
    ];
    const { homeAssets } = bucketAssetsForProcessing(assets, 'https://example.com/');
    expect(homeAssets.map(a => a.url).sort()).toEqual(['a', 'b']);
  });
});
