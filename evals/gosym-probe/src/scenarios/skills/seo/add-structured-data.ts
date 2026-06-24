import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addStructuredDataScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-add-structured-data',
      staticFirstMessage:
        'I run a local bakery called Sweet Crumbs at 456 Oak St, Portland. Can you add structured data to my homepage so Google shows my business info in search results?',
      goals: [
        {
          description: 'Agent installs the SEO skill',
          assertion: 'positive',
        },
        {
          description: 'Agent adds JSON-LD structured data (not microdata or RDFa)',
          assertion: 'positive',
        },
        {
          description: 'Agent uses LocalBusiness schema type (since the business has a physical location)',
          assertion: 'positive',
        },
        {
          description: 'Agent includes the provided business name and address in the structured data',
          assertion: 'positive',
        },
        {
          description: 'Agent wraps JSON-LD with JSON.stringify (not handwriting the JSON string)',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
