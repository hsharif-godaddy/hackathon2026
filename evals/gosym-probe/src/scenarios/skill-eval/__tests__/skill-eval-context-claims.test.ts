import { describe, it, expect } from 'vitest';
import { createSkillEval } from '../create-skill-eval.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';

describe('createSkillEval contextClaims threading', () => {
  it('forwards contextClaims onto the scenario', () => {
    const scenario = createSkillEval(
      {
        name: 'ce-cc-test',
        skill: 'marketing-campaigns',
        userIntent: 'Run a campaign',
        goals: [{ description: 'g', assertion: 'positive' }],
        skillInstructions: [
          { id: 'i1', instruction: 'do x', priority: 'required' },
        ],
        contextClaims: { marketingCampaignsEnabled: true },
      },
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );
    expect(scenario.contextClaims).toEqual({ marketingCampaignsEnabled: true });
  });
});
