import { describe, it, expect } from 'vitest';
import {
  campaignClarifyFirstScenario,
  campaignNoChannelPromptScenario,
} from '../index.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../__tests__/scenario-test-helpers.js';
import {
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../../types.js';

const gocode = makeGocodeClient();
const ctrlPlane = makeCtrlPlaneClient();

describe('marketing-campaigns scenarios', () => {
  describe('clarify-first', () => {
    const s = campaignClarifyFirstScenario(gocode, ctrlPlane);

    it('loads the marketing-campaigns skill on develop, suite, trials', () => {
      expect(s.name).toBe('marketing-campaign-clarify-first');
      expect(s.suite).toBe('marketing-campaigns');
      expect(s.expectedAgent).toBe(DEVELOP_AGENT_DISPLAY_NAME);
      expect(s.expectedSkills).toContain('marketing-campaigns');
      expect(s.trials).toBe(5);
      expect(s.contextClaims).toEqual({ marketingCampaignsEnabled: true });
    });

    it('asserts skill load, clarifying question, campaignPlanPropose, and no marketing handoff', () => {
      expect(s.expectedTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'skill', called: true }),
          expect.objectContaining({ tool: 'askQuestion', called: true }),
          expect.objectContaining({
            tool: 'marketing-campaigns__campaignPlanPropose',
            called: true,
          }),
          NO_MARKETING_HANDOFF,
        ]),
      );
    });

    it('requires loads-marketing-campaigns, clarifies-before-plan, and proposes-via-tool instructions', () => {
      const ids = (s.skillInstructions ?? []).map((i) => i.id);
      expect(ids).toContain('loads-marketing-campaigns');
      expect(ids).toContain('clarifies-before-plan');
      expect(ids).toContain('proposes-via-tool');
    });
  });

  describe('no-channel-prompt', () => {
    const s = campaignNoChannelPromptScenario(gocode, ctrlPlane);

    it('loads marketing-campaigns for promotion-style phrasing', () => {
      expect(s.name).toBe('marketing-campaign-no-channel-prompt');
      expect(s.suite).toBe('marketing-campaigns');
      expect(s.expectedAgent).toBe(DEVELOP_AGENT_DISPLAY_NAME);
      expect(s.expectedSkills).toContain('marketing-campaigns');
      expect(s.contextClaims).toEqual({ marketingCampaignsEnabled: true });
    });

    it('asserts skill load, campaignPlanPropose, and no marketing handoff', () => {
      expect(s.expectedTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'skill', called: true }),
          expect.objectContaining({
            tool: 'marketing-campaigns__campaignPlanPropose',
            called: true,
          }),
          NO_MARKETING_HANDOFF,
        ]),
      );
    });
  });
});
