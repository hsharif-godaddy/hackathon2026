import { describe, it, expect } from 'vitest';
import {
  campaignClarifyFirstScenario,
  campaignNoChannelPromptScenario,
  campaignVagueIntentCustomersScenario,
  campaignVagueIntentGrowScenario,
} from '../index.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../__tests__/scenario-test-helpers.js';
import {
  MARKETING_AGENT_DISPLAY_NAME,
  MARKETING_HANDOFF,
} from '../../../types.js';

const gocode = makeGocodeClient();
const ctrlPlane = makeCtrlPlaneClient();

describe('marketing-campaigns scenarios', () => {
  describe('clarify-first (createSkillEval)', () => {
    const s = campaignClarifyFirstScenario(gocode, ctrlPlane);
    it('targets the marketing agent + marketing-campaigns skill, suite, trials', () => {
      expect(s.name).toBe('marketing-campaign-clarify-first');
      expect(s.suite).toBe('marketing-campaigns');
      expect(s.expectedAgent).toBe(MARKETING_AGENT_DISPLAY_NAME);
      expect(s.expectedSkills).toContain('marketing-campaigns');
      expect(s.trials).toBe(3);
    });
    it('gates the skill via the marketingCampaignsEnabled claim', () => {
      expect(s.contextClaims).toEqual({ marketingCampaignsEnabled: true });
    });
    it('asserts skill load, a clarifying question, and the marketing handoff', () => {
      expect(s.expectedTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'skill', called: true }),
          expect.objectContaining({ tool: 'askQuestion', called: true }),
          MARKETING_HANDOFF,
        ]),
      );
    });
  });

  describe('no-channel-prompt (createSkillEval)', () => {
    const s = campaignNoChannelPromptScenario(gocode, ctrlPlane);
    it('targets the marketing agent + marketing-campaigns skill', () => {
      expect(s.name).toBe('marketing-campaign-no-channel-prompt');
      expect(s.suite).toBe('marketing-campaigns');
      expect(s.expectedAgent).toBe(MARKETING_AGENT_DISPLAY_NAME);
      expect(s.expectedSkills).toContain('marketing-campaigns');
      expect(s.contextClaims).toEqual({ marketingCampaignsEnabled: true });
    });
    it('asserts skill load, a clarifying question, and the marketing handoff', () => {
      expect(s.expectedTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'skill', called: true }),
          expect.objectContaining({ tool: 'askQuestion', called: true }),
          MARKETING_HANDOFF,
        ]),
      );
    });
  });

  describe('vague-intent scenarios (createPromptVsSkillScenario)', () => {
    const customers = campaignVagueIntentCustomersScenario(gocode, ctrlPlane);
    const grow = campaignVagueIntentGrowScenario(gocode, ctrlPlane);

    it('send the verbatim vague prompts', () => {
      expect(customers.name).toBe('marketing-campaign-vague-intent-customers');
      expect(customers.staticFirstMessage).toBe('I want more customers');
      expect(grow.name).toBe('marketing-campaign-vague-intent-grow');
      expect(grow.staticFirstMessage).toBe('I want to grow my business');
    });

    it('assert the marketing handoff, carry the claim, and do NOT pin a skill', () => {
      for (const s of [customers, grow]) {
        expect(s.suite).toBe('marketing-campaigns');
        expect(s.expectedTools).toContainEqual(MARKETING_HANDOFF);
        expect(s.expectedSkills).toBeUndefined();
        expect(s.contextClaims).toEqual({ marketingCampaignsEnabled: true });
      }
    });
  });

  it('clarify-first asserts the namespaced campaignPlanPropose tool', () => {
    const s = campaignClarifyFirstScenario(gocode, ctrlPlane);
    expect(s.expectedTools).toContainEqual(
      expect.objectContaining({
        tool: 'marketing-campaigns__campaignPlanPropose',
        called: true,
      }),
    );
    const ids = (s.skillInstructions ?? []).map((i) => i.id);
    expect(ids).toContain('proposes-via-tool');
  });

  it('no-channel-prompt asserts campaignPlanPropose and channel prompting', () => {
    const s = campaignNoChannelPromptScenario(gocode, ctrlPlane);
    expect(s.expectedTools).toContainEqual(
      expect.objectContaining({
        tool: 'marketing-campaigns__campaignPlanPropose',
        called: true,
      }),
    );
    const ids = (s.skillInstructions ?? []).map((i) => i.id);
    expect(ids).toContain('prompts-for-channel');
    expect(ids).toContain('proposes-via-tool');
  });
});
