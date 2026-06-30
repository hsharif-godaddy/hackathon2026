import { createGoogleReviewsScenario }
  from './create-google-reviews-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addGoogleReviewsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleReviewsScenario(
    {
      name: 'google-reviews-add-reviews-section',
      staticFirstMessage:
        'Add my Google reviews to the homepage so visitors can see'
        + ' what customers are saying about us',
      goals: [
        {
          description:
            'Agent loads the google-reviews skill via'
            + ' skill({ action: "load", skill: "google-reviews" })',
          assertion: 'positive',
        },
        {
          description:
            'Agent calls google-reviews__executeWorkflow to handle'
            + ' the full connection + review fetch flow',
          assertion: 'positive',
        },
        {
          description:
            'Agent installs the skill via'
            + ' skill({ action: "install", skill: "google-reviews" })'
            + ' and generates a GoogleReviews component',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'google-reviews__executeWorkflow', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
