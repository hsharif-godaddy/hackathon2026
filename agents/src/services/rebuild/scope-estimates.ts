import type { RebuildScope, RebuildScopeEstimate, RebuildWorkflowState } from '../../types/rebuild.js';
import { isRebuildHomepage } from '../../utils/rebuild-utils.js';

/** Legacy default when no intake scope is set (pre-intake behavior) */
export const MAX_PAGES_TO_SCRAPE = 20;

export const REBUILD_SCOPE_ESTIMATES: readonly RebuildScopeEstimate[] = [
  {
    scope: 'homepage_only',
    labelKey: 'builder_rebuild_intake_scope_homepage_label',
    descriptionKey: 'builder_rebuild_intake_scope_homepage_description',
    expectedMinutesMin: 3,
    expectedMinutesMax: 8,
    tokenCostMin: 50_000, // TODO: get from AIROBUILD-1902 telemetry rather than static value
    tokenCostMax: 150_000,
    // Discover inner pages for the manual page picker; only homepage is built upfront.
    maxPagesToScrape: 5,
    maxPagesToBuildUpfront: 1,
  },
  {
    scope: 'small',
    labelKey: 'builder_rebuild_intake_scope_small_label',
    descriptionKey: 'builder_rebuild_intake_scope_small_description',
    expectedMinutesMin: 8,
    expectedMinutesMax: 20,
    tokenCostMin: 150_000,
    tokenCostMax: 400_000,
    // Scrape extra pages so Continue building can offer beyond the upfront plan.
    maxPagesToScrape: 10,
    maxPagesToBuildUpfront: 5,
  },
  {
    scope: 'large',
    labelKey: 'builder_rebuild_intake_scope_large_label',
    descriptionKey: 'builder_rebuild_intake_scope_large_description',
    expectedMinutesMin: 15,
    expectedMinutesMax: 35,
    tokenCostMin: 300_000,
    tokenCostMax: 800_000,
    maxPagesToScrape: 15,
    maxPagesToBuildUpfront: 10,
  },
] as const;

export function getScopeEstimate(scope: RebuildScope): RebuildScopeEstimate {
  const estimate = REBUILD_SCOPE_ESTIMATES.find(e => e.scope === scope);
  if (!estimate) {
    throw new Error(`Unknown rebuild scope: ${scope}`);
  }
  return estimate;
}

export function resolveMaxPagesToScrape(state: RebuildWorkflowState): number {
  if (!state.rebuildScope) {
    return MAX_PAGES_TO_SCRAPE;
  }
  return getScopeEstimate(state.rebuildScope).maxPagesToScrape;
}

/** Used by upfront multi-page build (AIROBUILD-2308) via RebuildOrchestrationService.getUpfrontBuildSlugs. */
export function resolveMaxPagesToBuildUpfront(state: RebuildWorkflowState): number {
  if (!state.rebuildScope) {
    return 1;
  }
  return getScopeEstimate(state.rebuildScope).maxPagesToBuildUpfront;
}

/** Scraped pages to build in the first pass (homepage first, capped by scope). Called from getUpfrontBuildSlugs (2308). */
export function selectUpfrontBuildSlugs(
  pages: ReadonlyArray<{ url: string; slug: string }>,
  rootPath: string,
  state: Pick<RebuildWorkflowState, 'rebuildScope'>,
): string[] {
  return capDiscoveredPages(
    [...pages],
    rootPath,
    resolveMaxPagesToBuildUpfront(state as RebuildWorkflowState),
  ).map(page => page.slug);
}

/** Prefer homepage, then preserve discovery order, capped at maxPages */
export function capDiscoveredPages<T extends { url: string }>(
  pages: T[],
  rootPath: string,
  maxPages: number,
): T[] {
  const homepage = pages.find(p => isRebuildHomepage(p.url, rootPath));
  const rest = pages.filter(p => !isRebuildHomepage(p.url, rootPath));
  const ordered = homepage ? [homepage, ...rest] : rest;
  return ordered.slice(0, maxPages);
}
