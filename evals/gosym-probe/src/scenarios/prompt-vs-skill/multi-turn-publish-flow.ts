import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function multiTurnPublishFlowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-multi-turn-publish-flow',
      goals: [
        {
          description: 'Build a simple hello world site',
          assertion: 'positive',
        },
        {
          description: 'Publish the site to production',
          assertion: 'positive',
        },
        {
          description: 'Is it healthy?',
          assertion: 'positive',
        },
        {
          description: 'Publish the site to production again',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
