import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function useSemanticHtmlScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-semantic-html',
      staticFirstMessage:
        'Please improve the semantic HTML structure of my site'
        + ' for SEO and accessibility — I need proper <main> and'
        + ' <nav> elements with aria-label attributes.',
      goals: [
        {
          description:
            'Agent installs the SEO skill via'
            + ' skill({ action: "install", skill: "seo" })',
          assertion: 'positive',
        },
        {
          description:
            'Agent writes at least one page file that wraps'
            + ' primary content in a <main> element rather than'
            + ' a bare outer <div>',
          assertion: 'positive',
        },
        {
          description:
            'Agent adds aria-label attributes to <nav> elements'
            + ' in the written code',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT write any <nav> element without an'
            + ' aria-label attribute',
          assertion: 'negative',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'writeFile', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
