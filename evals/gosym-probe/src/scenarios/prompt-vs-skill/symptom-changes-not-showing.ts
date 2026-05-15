import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function symptomChangesNotShowingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-symptom-changes-not-showing',
      goals: [
        {
          description: 'Build a simple hello world site',
          assertion: 'positive',
        },
        {
          description:
            'The changes I made are not showing up for my customers' +
            ' — get the agent to diagnose and resolve the issue',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
