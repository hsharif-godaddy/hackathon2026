import { createGoldenLightScenario }
  from './create-golden-light-scenario.js';
import { multipageCatalogExpectation }
  from './expectations/multipage-catalog.expectation.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../evaluators/expected-artifact-match.js';
import { createNarrowArtifactJudge }
  from '../../evaluators/narrow-artifact-judge.js';
import { SkillSelectionEvaluator }
  from '../../evaluators/skill-selection.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import { DEVELOP_AGENT_DISPLAY_NAME } from '../types.js';

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
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  calibrate: boolean = false,
): Scenario {
  return createGoldenLightScenario(
    {
      name: 'multipage-catalog',
      staticFirstMessage: STATIC_PROMPT,
      extraEvaluators: [
        new ExpectedArtifactMatchEvaluator(),
        new SkillSelectionEvaluator(),
      ],
      calibrationEvaluators: [createNarrowArtifactJudge(gocode)],
      calibrate,
      expectedArtifact: multipageCatalogExpectation,
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      // A storefront with priced products is a commerce use case:
      // products should be backed by the GoDaddy commerce platform, not
      // hardcoded markup. The prompt never says "sell/checkout"
      // explicitly, but "shop + product catalog + prices" is a
      // deliberate, considered expectation that the develop agent loads
      // `commerce` (see run 2b52c36b: 0/10 — agent built the catalog from
      // pretrained knowledge and loaded only media-logo, never commerce).
      expectedSkills: ['commerce'],
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
