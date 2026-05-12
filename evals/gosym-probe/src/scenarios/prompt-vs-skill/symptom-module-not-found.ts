import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function symptomModuleNotFoundScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-symptom-module-not-found',
      goals: [
        {
          description: 'Build a simple hello world site',
          assertion: 'positive',
        },
        {
          description:
            'I am getting "Cannot find module" in production but not' +
            ' in development — get the agent to explain the' +
            ' alpine/native addon constraint and resolve the issue',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
