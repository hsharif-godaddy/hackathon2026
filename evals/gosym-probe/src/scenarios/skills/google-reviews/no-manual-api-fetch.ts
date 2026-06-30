import { createGoogleReviewsScenario }
  from './create-google-reviews-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noManualApiFetchScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleReviewsScenario(
    {
      name: 'google-reviews-no-manual-api-fetch',
      staticFirstMessage:
        'I want to fetch reviews from Google Places API and'
        + ' display them on my site',
      goals: [
        {
          description:
            'Agent uses the google-reviews skill (loads and calls'
            + ' executeWorkflow) instead of manually calling the'
            + ' Google Places API or Google My Business API',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT install googleapis, @googlemaps/google'
            + '-maps-services-js, or any Google API client library'
            + ' as a dependency',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT request a Google API key for fetching'
            + ' reviews (the skill handles this via OAuth)',
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
