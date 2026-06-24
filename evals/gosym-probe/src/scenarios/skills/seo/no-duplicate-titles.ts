import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noDuplicateTitlesScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-no-duplicate-titles',
      staticFirstMessage:
        'Add SEO metadata to my site. I have a homepage, about page, and services page.',
      goals: [
        {
          description: 'Agent installs the SEO skill',
          assertion: 'positive',
        },
        {
          description: 'Agent reads existing pages to understand their content before writing titles',
          assertion: 'positive',
        },
        {
          description: 'Agent creates unique, page-specific titles that describe each page purpose (not copying the homepage title)',
          assertion: 'positive',
        },
        {
          description: 'Agent creates unique meta descriptions specific to each page content',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT use the same title or description across multiple pages',
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
