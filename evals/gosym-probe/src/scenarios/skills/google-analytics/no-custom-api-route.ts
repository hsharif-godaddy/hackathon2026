import { createGoogleAnalyticsScenario } from './create-google-analytics-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noCustomApiRouteScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleAnalyticsScenario(
    {
      name: 'google-analytics-no-custom-api-route',
      staticFirstMessage:
        'I need Google Analytics on my site. Can you also make an API endpoint that returns my analytics config?',
      goals: [
        {
          description: 'Agent uses the skill installAnalytics tool which provides the built-in API route template',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT create additional custom API routes for analytics beyond what installAnalytics provides',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT explore or import #airo/secrets directly — the template handles this',
          assertion: 'positive',
        },
        {
          description: 'Agent explains that the analytics config endpoint is already included in the skill installation',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'google-analytics__installAnalytics', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
