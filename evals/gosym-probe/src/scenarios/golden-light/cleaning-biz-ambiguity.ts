import { createGoldenLightScenario }
  from './create-golden-light-scenario.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import { cleaningBizPersona }
  from '../../personas/cleaning-biz-owner.js';
import type { Scenario } from '../types.js';

export function cleaningBizAmbiguityScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoldenLightScenario(
    {
      name: 'cleaning-biz-ambiguity',
      staticFirstMessage: 'I need a website for my cleaning business',
      persona: cleaningBizPersona,
      goals: [
        {
          description:
            'The agent infers cleaning business basics from vague ' +
            'user input and builds a functional site with a ' +
            'services section and contact information',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
