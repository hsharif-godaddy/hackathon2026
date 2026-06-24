import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addMetaTagsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-add-meta-tags',
      staticFirstMessage:
        'I need to add proper SEO meta tags to all pages of my site — titles, descriptions, and Open Graph tags',
      goals: [
        {
          description: 'Agent installs the SEO skill via skill({ action: "install", skill: "seo" })',
          assertion: 'positive',
        },
        {
          description: 'Agent discovers existing pages via directoryListing or grepSearch',
          assertion: 'positive',
        },
        {
          description: 'Agent adds unique <title> to each page (not duplicating homepage title)',
          assertion: 'positive',
        },
        {
          description: 'Agent adds <meta name="description"> with unique content per page',
          assertion: 'positive',
        },
        {
          description: 'Agent adds Open Graph tags (og:title, og:description, og:image, og:url) to pages',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'grepSearch', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
