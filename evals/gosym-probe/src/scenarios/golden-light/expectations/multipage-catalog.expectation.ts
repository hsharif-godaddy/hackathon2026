import type { ExpectedArtifactSpec } from '../../types.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import { hasRenderedContent } from '../../matchers/rendered-content.js';
import { noModuleNotFoundItem } from '../../matchers/checklist-items.js';

/** Count of reachable (ok/redirect) non-home routes — the multi-page signal. */
function reachableSubRoutes(site: CapturedSite): number {
  return site.routes.filter(
    (r) =>
      (r.status === 'ok' || r.status === 'redirect') && r.path !== '/',
  ).length;
}

/**
 * Expectation fixture for the multipage-catalog scenario (commerce skill
 * test). The prompt asks for a multi-page handmade-crafts storefront
 * (homepage + product catalog + about), React Router, API-fed products.
 *
 * Capability matchers assert behaviors, never golden output: a rendered
 * site, more than one reachable route (multi-page), and catalog/product
 * copy somewhere in the rendered signals. Tuned to pass on a real
 * commerce build while still able to fail on a single-page or blank one.
 */
export const multipageCatalogExpectation: ExpectedArtifactSpec = {
  intent:
    'Build a multi-page handmade-crafts storefront: homepage, a product '
    + 'catalog with category filters, and an about page — shared nav, '
    + 'API-fed products.',
  evalVersion: 'v1',
  items: [
    {
      id: 'home-route-reachable',
      description: 'the home route renders successfully (HTTP ok)',
      type: 'capability',
      routeMatcher: { path: '/', mustBeReachable: true },
    },
    {
      id: 'has-rendered-content',
      description: 'the site renders non-trivial text content',
      type: 'capability',
      domMatcher: (site, snapshots) => hasRenderedContent(site, snapshots),
    },
    {
      id: 'is-multi-page',
      description: 'at least one reachable route beyond the homepage',
      type: 'capability',
      domMatcher: (site) => reachableSubRoutes(site) >= 1,
    },
    noModuleNotFoundItem,
    {
      id: 'mentions-catalog',
      description: 'rendered copy references products / catalog / shop',
      type: 'directional',
      domMatcher: (site) =>
        site.perRoute.some((rc) => {
          const r = rc.rendered;
          if (!r) return false;
          return /product|catalog|shop|store|collection|crafts|pottery|textile|jewelry|woodwork/i.test(
            `${r.title} ${r.h1 ?? ''} ${r.headingText} ${r.bodyPreview}`,
          );
        }),
    },
  ],
};
