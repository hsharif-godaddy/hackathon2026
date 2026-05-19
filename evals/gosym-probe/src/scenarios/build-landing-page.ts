import { createGoldenLightScenario }
  from './golden-light/create-golden-light-scenario.js';
import { beginnerPersona } from '../personas/beginner.js';
import { WebsiteQualityEvaluator }
  from '../evaluators/website-quality.js';
import type { IGocodeClient }
  from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../clients/aab-ctrl-plane-client.js';
import type { Config } from '../../config/environments/types.js';
import type { Scenario } from './types.js';

export function buildLandingPageScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const visionModel = config?.gocode.visionModel;
  const extraEvaluators = visionModel
    ? [new WebsiteQualityEvaluator(gocode.withModel(visionModel))]
    : [];

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
      extraEvaluators,
    },
    gocode,
    ctrlPlane,
  );
}
