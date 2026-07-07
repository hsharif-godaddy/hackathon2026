import { describe, it, expect } from 'vitest';
import { setupChatWidgetScenario }
  from '../setup-chat-widget.js';
import { setupContactFormScenario }
  from '../setup-contact-form.js';
import { whereAreMessagesScenario }
  from '../where-are-messages.js';
import { viewFormSubmissionsScenario }
  from '../view-form-submissions.js';
import { noMultiStepSetupScenario }
  from '../no-multi-step-setup.js';
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

describe('inbox suite scenarios', () => {
  describe('inbox-setup-chat-widget', () => {
    const scenario = setupChatWidgetScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('inbox-setup-chat-widget');
      expect(scenario.suite).toBe('inbox');
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

    it('expects skill and setup_chat_widget tools', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'inbox__setup_chat_widget',
          called: true,
        }),
      );
    });

    it('defaults to 1 trial', () => {
      expect(scenario.trials).toBe(1);
    });
  });

  describe('inbox-setup-contact-form', () => {
    const scenario = setupContactFormScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('inbox-setup-contact-form');
      expect(scenario.suite).toBe('inbox');
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

    it('expects skill and setup_contact_form tools', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'inbox__setup_contact_form',
          called: true,
        }),
      );
    });

    it('defaults to 1 trial', () => {
      expect(scenario.trials).toBe(1);
    });
  });

  describe('inbox-where-are-messages', () => {
    const scenario = whereAreMessagesScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('inbox-where-are-messages');
      expect(scenario.suite).toBe('inbox');
    });

    it('has 2 goals', () => {
      expect(scenario.goals).toHaveLength(2);
    });

    it('uses standard persona', () => {
      expect(scenario.persona.name).toBe('standard');
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill tool called', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
    });

    it('defaults to 1 trial', () => {
      expect(scenario.trials).toBe(1);
    });
  });

  describe('inbox-view-form-submissions', () => {
    const scenario = viewFormSubmissionsScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('inbox-view-form-submissions');
      expect(scenario.suite).toBe('inbox');
    });

    it('has 2 goals', () => {
      expect(scenario.goals).toHaveLength(2);
    });

    it('uses standard persona', () => {
      expect(scenario.persona.name).toBe('standard');
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('defaults to 1 trial', () => {
      expect(scenario.trials).toBe(1);
    });
  });

  describe('inbox-no-multi-step-setup', () => {
    const scenario = noMultiStepSetupScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('inbox-no-multi-step-setup');
      expect(scenario.suite).toBe('inbox');
    });

    it('has 2 goals', () => {
      expect(scenario.goals).toHaveLength(2);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects setup_chat_widget called and discover_account NOT called', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'inbox__setup_chat_widget',
          called: true,
        }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({
          tool: 'inbox__discover_account',
          called: false,
        }),
      );
    });

    it('defaults to 1 trial', () => {
      expect(scenario.trials).toBe(1);
    });
  });
});
