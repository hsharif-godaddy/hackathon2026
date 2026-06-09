import { describe, expect, it } from 'vitest';

import type { RebuildWorkflowState } from '../../../types/rebuild.js';
import {
  isRebuildReadyForUpfrontBuild,
  isRebuildScrapeProgressComplete,
  isRebuildScrapeSettled,
} from '../scrape-completion.js';

function baseState(overrides: Partial<RebuildWorkflowState> = {}): RebuildWorkflowState {
  return {
    appId: 'app-123',
    sourceUrl: 'https://example.com',
    rootPath: '/',
    status: 'style_questions',
    scrapingProgress: { total: 0, completed: 0 },
    pagesBuilt: [],
    currentPage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scrape-completion', function scrapeCompletionTests() {
  it('isRebuildScrapeProgressComplete requires completed >= total > 0', function progressComplete() {
    expect(isRebuildScrapeProgressComplete({ scrapingProgress: { total: 5, completed: 5 } })).toBe(true);
    expect(isRebuildScrapeProgressComplete({ scrapingProgress: { total: 5, completed: 1 } })).toBe(false);
    expect(isRebuildScrapeProgressComplete({ scrapingProgress: { total: 0, completed: 0 } })).toBe(false);
  });

  it('isRebuildScrapeSettled is true only when scrapeSettled flag is set', function scrapeSettled() {
    expect(isRebuildScrapeSettled({ scrapeSettled: true })).toBe(true);
    expect(isRebuildScrapeSettled({ scrapeSettled: false })).toBe(false);
    expect(isRebuildScrapeSettled({})).toBe(false);
  });

  it('isRebuildReadyForUpfrontBuild rejects early Atlas style_questions callback', function earlyCallback() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      status: 'style_questions',
      scrapingProgress: { total: 5, completed: 1 },
    }))).toBe(false);
  });

  it('rejects homepage-only progress for small scope before scrape settles', function atlasHomepageCallback() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      rebuildScope: 'small',
      status: 'style_questions',
      scrapingProgress: { total: 1, completed: 1 },
    }))).toBe(false);
  });

  it('accepts full progress for small scope when all pages scraped', function smallScopeFullProgress() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      rebuildScope: 'small',
      status: 'style_questions',
      scrapingProgress: { total: 4, completed: 4 },
    }))).toBe(true);
  });

  it('isRebuildReadyForUpfrontBuild accepts settled Atlas post-crawl state', function settledPostCrawl() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      status: 'style_questions',
      scrapingProgress: { total: 5, completed: 1 },
      scrapeSettled: true,
    }))).toBe(true);
  });

  it('isRebuildReadyForUpfrontBuild accepts legacy scrape-complete state', function legacyComplete() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      status: 'style_questions',
      scrapingProgress: { total: 3, completed: 3 },
    }))).toBe(true);
  });

  it('isRebuildReadyForUpfrontBuild accepts building after scrape settles', function buildingAfterSettle() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      status: 'building',
      scrapingProgress: { total: 5, completed: 5 },
    }))).toBe(true);
  });

  it('rejects early Atlas callback for homepage_only when discovering inner pages', function homepageOnlyDiscover() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      rebuildScope: 'homepage_only',
      status: 'style_questions',
      scrapingProgress: { total: 1, completed: 1 },
    }))).toBe(false);
  });

  it('accepts homepage_only after scrape settles with only homepage built upfront', function homepageOnlySettled() {
    expect(isRebuildReadyForUpfrontBuild(baseState({
      rebuildScope: 'homepage_only',
      status: 'style_questions',
      scrapingProgress: { total: 4, completed: 4 },
      scrapeSettled: true,
    }))).toBe(true);
  });
});
