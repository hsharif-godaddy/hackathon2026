import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function registerNewRouteScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-register-new-route',
      staticFirstMessage:
        'I just created a new /pricing page. Can you make sure it shows up in the sitemap and has proper SEO?',
      goals: [
        {
          description: 'Agent installs the SEO skill',
          assertion: 'positive',
        },
        {
          description: 'Agent adds the /pricing route to src/lib/seo-routes.ts for sitemap registration',
          assertion: 'positive',
        },
        {
          description: 'Agent adds Helmet metadata (title, description, canonical) to the pricing page',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT create a robots.txt file (it is auto-generated)',
          assertion: 'negative',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'readFile', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
