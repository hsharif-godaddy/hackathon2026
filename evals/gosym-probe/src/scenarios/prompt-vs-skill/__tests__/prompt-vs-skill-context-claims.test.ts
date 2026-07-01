import { describe, it, expect } from 'vitest';
import { createPromptVsSkillScenario } from '../create-prompt-vs-skill-scenario.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';

describe('createPromptVsSkillScenario contextClaims threading', () => {
  it('sets contextClaims on the returned scenario', () => {
    const scenario = createPromptVsSkillScenario(
      {
        name: 'pvs-cc-test',
        goals: [{ description: 'g', assertion: 'positive' }],
        contextClaims: { marketingCampaignsEnabled: true },
      },
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );
    expect(scenario.contextClaims).toEqual({ marketingCampaignsEnabled: true });
  });

  it('leaves contextClaims undefined when not provided', () => {
    const scenario = createPromptVsSkillScenario(
      {
        name: 'pvs-no-cc',
        goals: [{ description: 'g', assertion: 'positive' }],
      },
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );
    expect(scenario.contextClaims).toBeUndefined();
  });
});
