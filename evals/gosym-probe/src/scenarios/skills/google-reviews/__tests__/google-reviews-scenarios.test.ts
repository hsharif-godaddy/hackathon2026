import { describe, it, expect } from 'vitest';
import { addGoogleReviewsScenario }
  from '../add-google-reviews.js';
import { oauthConnectionFlowScenario }
  from '../oauth-connection-flow.js';
import { noManualApiFetchScenario }
  from '../no-manual-api-fetch.js';
import { socialProofTriggeringScenario }
  from '../social-proof-triggering.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../../scenarios/__tests__/scenario-test-helpers.js';

const mockGocode = makeGocodeClient();
const mockCtrlPlane = makeCtrlPlaneClient();

const REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'tool-call-verification',
  'jtbd-completion',
  'tool-parallelism',
  'turn-duration',
  'token-usage',
  'llm-cost',
];

describe('google-reviews suite scenarios', () => {
  describe('google-reviews-add-reviews-section', () => {
    const scenario = addGoogleReviewsScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name)
        .toBe('google-reviews-add-reviews-section');
      expect(scenario.suite).toBe('google-reviews');
    });

    it('has 3 goals', () => {
      expect(scenario.goals).toHaveLength(3);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and executeWorkflow tools', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'google-reviews__executeWorkflow',
          called: true,
        }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('google-reviews-oauth-connection-flow', () => {
    const scenario = oauthConnectionFlowScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name)
        .toBe('google-reviews-oauth-connection-flow');
      expect(scenario.suite).toBe('google-reviews');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects executeWorkflow called and socialConnect NOT called', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'google-reviews__executeWorkflow',
          called: true,
        }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'social-platform__socialConnect',
          called: false,
        }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('google-reviews-no-manual-api-fetch', () => {
    const scenario = noManualApiFetchScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name)
        .toBe('google-reviews-no-manual-api-fetch');
      expect(scenario.suite).toBe('google-reviews');
    });

    it('has 3 goals', () => {
      expect(scenario.goals).toHaveLength(3);
    });

    it('uses a static first message mentioning Google Places API', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage)
        .toContain('Google Places API');
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('google-reviews-social-proof-triggering', () => {
    const scenario = socialProofTriggeringScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name)
        .toBe('google-reviews-social-proof-triggering');
      expect(scenario.suite).toBe('google-reviews');
    });

    it('has 2 goals', () => {
      expect(scenario.goals).toHaveLength(2);
    });

    it('uses standard persona (decisive user)', () => {
      expect(scenario.persona.name).toBe('standard');
    });

    it('uses a static first message with indirect phrasing', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage)
        .toContain('social proof');
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });
});
