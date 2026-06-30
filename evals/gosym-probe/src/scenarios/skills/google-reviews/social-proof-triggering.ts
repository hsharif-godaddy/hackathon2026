import { createGoogleReviewsScenario }
  from './create-google-reviews-scenario.js';
import { standardPersona } from '../../../personas/standard.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function socialProofTriggeringScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoogleReviewsScenario(
    {
      name: 'google-reviews-social-proof-triggering',
      persona: standardPersona,
      staticFirstMessage:
        'I want to add some social proof to my landing page —'
        + ' maybe show customer testimonials from Google',
      goals: [
        {
          description:
            'Agent identifies this as a google-reviews skill use'
            + ' case and loads the skill',
          assertion: 'positive',
        },
        {
          description:
            'Agent calls google-reviews__executeWorkflow (does not'
            + ' suggest a manual testimonials section with hardcoded'
            + ' data)',
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
