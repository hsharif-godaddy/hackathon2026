import { describe, it, expect } from 'vitest';
import { addEmailAuthScenario } from '../add-email-auth.js';
import { addOAuthAuthScenario } from '../add-oauth-auth.js';
import { addBothAuthScenario } from '../add-both-auth.js';
import { passwordProtectPageScenario }
  from '../password-protect-page.js';
import { noCustomProvidersScenario }
  from '../no-custom-providers.js';
import { databasePrerequisiteScenario }
  from '../database-prerequisite.js';
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

describe('authentication suite scenarios', () => {
  describe('auth-add-email-password', () => {
    const scenario = addEmailAuthScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-add-email-password');
      expect(scenario.suite).toBe('authentication');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
      expect(
        scenario.goals.every((g) => g.description.length > 0),
      ).toBe(true);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and requestSecrets tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'requestSecrets', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('auth-add-oauth-google', () => {
    const scenario = addOAuthAuthScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-add-oauth-google');
      expect(scenario.suite).toBe('authentication');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
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

  describe('auth-add-both-email-and-oauth', () => {
    const scenario = addBothAuthScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-add-both-email-and-oauth');
      expect(scenario.suite).toBe('authentication');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('email and password');
      expect(scenario.staticFirstMessage).toContain('Google');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and requestSecrets tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'requestSecrets', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('auth-password-protect-page', () => {
    const scenario = passwordProtectPageScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-password-protect-page');
      expect(scenario.suite).toBe('authentication');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain(
        'Password protect',
      );
    });

    it('has 3 goals', () => {
      expect(scenario.goals).toHaveLength(3);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('auth-no-custom-providers', () => {
    const scenario = noCustomProvidersScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-no-custom-providers');
      expect(scenario.suite).toBe('authentication');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
    });

    it('has 4 goals covering positive and negative assertions', () => {
      expect(scenario.goals).toHaveLength(4);
      expect(
        scenario.goals.every((g) => g.assertion === 'positive'),
      ).toBe(true);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('auth-database-prerequisite', () => {
    const scenario = databasePrerequisiteScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('auth-database-prerequisite');
      expect(scenario.suite).toBe('authentication');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });
});
