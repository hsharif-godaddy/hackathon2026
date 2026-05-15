import { createGoldenLightScenario }
  from './golden-light/create-golden-light-scenario.js';
import { beginnerPersona } from '../personas/beginner.js';
import type { IGocodeClient }
  from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

export function buildLandingPageScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoldenLightScenario(
    {
      name: 'build-landing-page',
      goals: [
        {
          description:
            'The agent creates a landing page with a hero ' +
            'section containing a headline and subheadline',
          assertion: 'positive',
        },
        {
          description:
            'The page includes a call-to-action button',
          assertion: 'positive',
        },
      ],
      persona: beginnerPersona,
      suite: null,
      trials: 1,
    },
    gocode,
    ctrlPlane,
  );
}
