import { describe, expect, it } from 'vitest';

import type { RebuildWorkflowState } from '../../../types/rebuild.js';
import {
  capDiscoveredPages,
  getScopeEstimate,
  resolveMaxPagesToBuildUpfront,
  resolveMaxPagesToScrape,
  REBUILD_SCOPE_ESTIMATES,
  selectUpfrontBuildSlugs,
} from '../scope-estimates.js';

describe('scope-estimates', () => {
  it('returns caps for homepage_only', () => {
    expect(getScopeEstimate('homepage_only').maxPagesToScrape).toBe(5);
    expect(getScopeEstimate('homepage_only').maxPagesToBuildUpfront).toBe(1);
  });

  it('returns caps for small and large', () => {
    expect(getScopeEstimate('small').maxPagesToScrape).toBe(10);
    expect(getScopeEstimate('small').maxPagesToBuildUpfront).toBe(5);
    expect(getScopeEstimate('large').maxPagesToScrape).toBe(15);
    expect(getScopeEstimate('large').maxPagesToBuildUpfront).toBe(10);
  });

  it('defaults to legacy cap when scope unset', () => {
    const state = { rebuildScope: undefined } as RebuildWorkflowState;
    expect(resolveMaxPagesToScrape(state)).toBe(20);
  });

  it('uses scope cap when set', () => {
    const state = { rebuildScope: 'small' } as RebuildWorkflowState;
    expect(resolveMaxPagesToScrape(state)).toBe(10);
  });

  it('keeps homepage and trims to maxPages', () => {
    const pages = [
      { url: 'https://example.com/about' },
      { url: 'https://example.com/' },
      { url: 'https://example.com/contact' },
    ];
    const capped = capDiscoveredPages(pages, '/', 2);
    expect(capped).toHaveLength(2);
    expect(capped[0].url).toBe('https://example.com/');
  });

  it('defaults upfront build count to 1 when scope unset', () => {
    const state = { rebuildScope: undefined } as RebuildWorkflowState;
    expect(resolveMaxPagesToBuildUpfront(state)).toBe(1);
  });

  it('selectUpfrontBuildSlugs keeps homepage first and caps by scope', () => {
    const pages = [
      { url: 'https://example.com/about', slug: 'about' },
      { url: 'https://example.com/', slug: 'homepage' },
      { url: 'https://example.com/contact', slug: 'contact' },
      { url: 'https://example.com/services', slug: 'services' },
    ];
    expect(selectUpfrontBuildSlugs(pages, '/', { rebuildScope: 'small' })).toEqual([
      'homepage',
      'about',
      'contact',
      'services',
    ]);
  });

  it('selectUpfrontBuildSlugs returns only homepage for homepage_only scope', () => {
    const pages = [
      { url: 'https://example.com/about', slug: 'about' },
      { url: 'https://example.com/', slug: 'homepage' },
    ];
    expect(selectUpfrontBuildSlugs(pages, '/', { rebuildScope: 'homepage_only' })).toEqual(['homepage']);
  });

  it('defines all three scopes', () => {
    expect(REBUILD_SCOPE_ESTIMATES.map(e => e.scope)).toEqual([
      'homepage_only',
      'small',
      'large',
    ]);
  });
});
