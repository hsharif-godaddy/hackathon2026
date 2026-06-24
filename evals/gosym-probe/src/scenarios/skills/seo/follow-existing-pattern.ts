import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function followExistingPatternScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-follow-existing-pattern',
      staticFirstMessage:
        'My homepage already has Helmet with meta tags. Can you add the same SEO setup to my new about page?',
      goals: [
        {
          description: 'Agent searches the codebase to discover the existing metadata pattern (grep for Helmet, metadata, Head, etc.)',
          assertion: 'positive',
        },
        {
          description: 'Agent reads an existing page that already has SEO implementation to identify the pattern',
          assertion: 'positive',
        },
        {
          description: 'Agent implements SEO on the new page using the SAME pattern/library as existing pages (not introducing a different approach)',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT install a new metadata library when one already exists',
          assertion: 'negative',
        },
      ],
      expectedTools: [
        { tool: 'grepSearch', called: true },
        { tool: 'readFile', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
