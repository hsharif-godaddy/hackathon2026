import { createBuildQualityScenario }
  from './create-build-quality-scenario.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

const STATIC_PROMPT = [
  'Build a multi-page website for "Artisan Goods Co.",',
  'a handmade crafts shop. I need:',
  '- Homepage with a hero banner, featured products',
  '  section, and a newsletter signup',
  '- Product catalog page with category filters',
  '  (pottery, textiles, woodwork, jewelry) and a grid',
  '  of product cards with images, names, and prices',
  '- About page with our story, team member profiles',
  '  with photos, and a mission statement',
  '- Shared navigation header and footer across all',
  '  pages',
  'Use React Router for page navigation. Products',
  'should be fetched from an API endpoint.',
].join('\n');

export function multipageCatalogScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createBuildQualityScenario(
    {
      name: 'multipage-catalog',
      staticFirstMessage: STATIC_PROMPT,
      goals: [
        {
          description:
            'The agent creates a multi-page website with a ' +
            'homepage, a product catalog page with category ' +
            'filtering, and an about page with team member ' +
            'profiles',
          assertion: 'positive',
        },
        {
          description:
            'The product catalog page loads product data from ' +
            'a service module or API endpoint rather than ' +
            'hardcoding product information directly in ' +
            'component markup',
          assertion: 'positive',
        },
        {
          description:
            'All pages share a consistent navigation header ' +
            'and footer through a reusable layout component',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
