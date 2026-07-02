import { createGoogleAnalyticsScenario } from './create-google-analytics-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addGoogleAnalyticsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleAnalyticsScenario(
    {
      name: 'google-analytics-add',
      staticFirstMessage:
        'I want to add Google Analytics to track visitors on my site',
      goals: [
        {
          description: 'Agent calls google-analytics__checkConfiguration to verify secret status',
          assertion: 'positive',
        },
        {
          description: 'Agent calls requestSecrets to collect the GA4 Measurement ID from the user',
          assertion: 'positive',
        },
        {
          description: 'Agent calls google-analytics__installAnalytics to install templates and patch RootLayout',
          assertion: 'positive',
        },
        {
          description: 'Agent confirms GA4 is set up and mentions cookie consent behavior',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'google-analytics__checkConfiguration', called: true },
        { tool: 'requestSecrets', called: true },
        { tool: 'google-analytics__installAnalytics', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
