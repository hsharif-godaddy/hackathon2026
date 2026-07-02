import { createGoogleAnalyticsScenario } from './create-google-analytics-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noManualRootlayoutEditScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleAnalyticsScenario(
    {
      name: 'google-analytics-no-manual-rootlayout-edit',
      staticFirstMessage:
        'Add GA4 analytics tracking to my website, my measurement ID is G-ABC123XYZ',
      goals: [
        {
          description: 'Agent uses google-analytics__installAnalytics tool to install analytics (not manual file editing)',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT manually edit RootLayout.tsx with writeFile or editFile tools',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT call skill({ action: "install" }) separately — installAnalytics handles template installation',
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
