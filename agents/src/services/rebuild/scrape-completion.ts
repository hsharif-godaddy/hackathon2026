import type { RebuildWorkflowState } from '../../types/rebuild.js';

import { resolveMaxPagesToBuildUpfront, resolveMaxPagesToScrape } from './scope-estimates.js';

const READY_FOR_UPFRONT_BUILD_STATUSES: ReadonlySet<RebuildWorkflowState['status']> = new Set([
  'style_questions',
  'building',
  'review',
  'complete',
]);

/** Scraping progress bar reflects all targeted pages persisted. */
export function isRebuildScrapeProgressComplete(
  state: Pick<RebuildWorkflowState, 'scrapingProgress'>,
): boolean {
  const { total, completed } = state.scrapingProgress;
  return total > 0 && completed >= total;
}

/** Scrape pipeline finished (including partial inner-page persist failures). */
export function isRebuildScrapeSettled(state: Pick<RebuildWorkflowState, 'scrapeSettled'>): boolean {
  return state.scrapeSettled === true;
}

function isMultiPageRebuildScope(scope: RebuildWorkflowState['rebuildScope']): boolean {
  return scope === 'small' || scope === 'large';
}

/** Scope discovers more pages than it builds upfront (e.g. homepage_only). */
function discoversBeyondUpfrontBuild(state: RebuildWorkflowState): boolean {
  if (!state.rebuildScope) {
    return false;
  }
  return resolveMaxPagesToScrape(state) > resolveMaxPagesToBuildUpfront(state);
}

/**
 * Atlas homepage-first crawl sets style_questions after the homepage callback while
 * inner pages are still persisting. The callback also sets scrapingProgress to 1/1
 * against a homepage-only sitemap — that must not satisfy readiness for small/large
 * scope upfront builds.
 */
export function isRebuildReadyForUpfrontBuild(state: RebuildWorkflowState): boolean {
  if (state.status === 'complete') {
    return true;
  }
  if (!READY_FOR_UPFRONT_BUILD_STATUSES.has(state.status)) {
    return false;
  }
  if (isRebuildScrapeSettled(state)) {
    return true;
  }
  if (isMultiPageRebuildScope(state.rebuildScope)) {
    return (
      isRebuildScrapeProgressComplete(state) &&
      state.scrapingProgress.total > 1
    );
  }
  if (discoversBeyondUpfrontBuild(state)) {
    return false;
  }
  return isRebuildScrapeProgressComplete(state);
}
