import { createGoogleReviewsScenario }
  from './create-google-reviews-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function oauthConnectionFlowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleReviewsScenario(
    {
      name: 'google-reviews-oauth-connection-flow',
      staticFirstMessage:
        'Show my Google Business Profile reviews on my site',
      goals: [
        {
          description:
            'Agent calls google-reviews__executeWorkflow which'
            + ' detects GBP is not connected and returns an OAuth'
            + ' signal',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT try to call social-platform__socialConnect'
            + ' or manually orchestrate OAuth — the tool handles it',
          assertion: 'positive',
        },
        {
          description:
            'Agent stays silent after receiving the awaiting-oauth'
            + ' response and waits for the user to complete'
            + ' authentication',
          assertion: 'positive',
        },
        {
          description:
            'Agent calls google-reviews__executeWorkflow again after'
            + ' user confirms OAuth completion',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'google-reviews__executeWorkflow', called: true },
        {
          tool: 'social-platform__socialConnect',
          called: false,
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
