import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function symptomBlankPageScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-symptom-blank-page',
      goals: [
        {
          description: 'Build a simple hello world site',
          assertion: 'positive',
        },
        {
          description:
            'Users are seeing a blank page but it works fine for me' +
            ' — get the agent to diagnose and resolve the issue',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
