import { describe, it, expect } from 'vitest';
import { addWelcomeEmailScenario } from '../add-welcome-email.js';
import { noNodemailerScenario } from '../no-nodemailer.js';
import { noSenderSpoofingScenario } from '../no-sender-spoofing.js';
import { emailWithAttachmentScenario } from '../email-with-attachment.js';
import { noRecipientFallbackScenario } from '../no-recipient-fallback.js';
import { emailOrderConfirmationScenario } from '../email-order-confirmation.js';
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

describe('email suite scenarios', () => {
  describe('email-add-welcome-email', () => {
    const scenario = addWelcomeEmailScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-add-welcome-email');
      expect(scenario.suite).toBe('email');
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

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('email-no-nodemailer', () => {
    const scenario = noNodemailerScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-no-nodemailer');
      expect(scenario.suite).toBe('email');
    });

    it('uses a static first message mentioning nodemailer', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('nodemailer');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('email-no-sender-spoofing', () => {
    const scenario = noSenderSpoofingScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-no-sender-spoofing');
      expect(scenario.suite).toBe('email');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
    });

    it('has 3 goals', () => {
      expect(scenario.goals).toHaveLength(3);
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

  describe('email-with-attachment', () => {
    const scenario = emailWithAttachmentScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-with-attachment');
      expect(scenario.suite).toBe('email');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('PDF');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('email-no-recipient-fallback', () => {
    const scenario = noRecipientFallbackScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-no-recipient-fallback');
      expect(scenario.suite).toBe('email');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('email');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
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

  describe('email-order-confirmation', () => {
    const scenario = emailOrderConfirmationScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('email-order-confirmation');
      expect(scenario.suite).toBe('email');
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('expects skill tool call', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });
});
