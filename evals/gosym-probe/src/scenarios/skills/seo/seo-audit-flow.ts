import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function seoAuditFlowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-audit-flow',
      staticFirstMessage:
        'Can you run an SEO audit on my site and tell me what needs fixing?',
      goals: [
        {
          description: 'Agent calls seoAnalysis or seo__audit to generate the audit report',
          assertion: 'positive',
        },
        {
          description: 'Agent stops after the audit report and does NOT immediately edit code in the same turn',
          assertion: 'positive',
        },
        {
          description: 'Agent presents findings and waits for user to request fixes',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'seoAnalysis', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
