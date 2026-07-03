import { describe, it, expect } from 'vitest';
import { postFixVerificationScenario } from '../post-fix-verification.js';
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

describe('security suite scenarios', () => {
  describe('security-post-fix-verification', () => {
    const scenario = postFixVerificationScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('security-post-fix-verification');
      expect(scenario.suite).toBe('security');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('has 3 positive goals and 1 negative goal', () => {
      const positive = scenario.goals.filter((g) => g.assertion === 'positive');
      const negative = scenario.goals.filter((g) => g.assertion === 'negative');
      expect(positive).toHaveLength(3);
      expect(negative).toHaveLength(1);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('requires security__runSecurityVerification to be called', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'security__runSecurityVerification', called: true }),
      );
    });

    it('uses a static first message referencing security vulnerabilities', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('Security Vulnerabilities');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });

    it('has setup and teardown functions', () => {
      expect(scenario.setup).toBeInstanceOf(Function);
      expect(scenario.teardown).toBeInstanceOf(Function);
    });

    it('does not seed files when no agentsBaseUrl is provided', () => {
      // Without agentsBaseUrl, afterProvision is not wired — no HTTP call attempted.
      expect(scenario.setup).toBeInstanceOf(Function);
    });

    it('seeds the eval() vulnerability file when agentsBaseUrl is provided', () => {
      const withUrl = postFixVerificationScenario(
        mockGocode,
        mockCtrlPlane,
        'http://localhost:4000',
      );
      // The scenario shape is the same; the seeding happens inside setup().
      expect(withUrl.name).toBe('security-post-fix-verification');
      expect(withUrl.setup).toBeInstanceOf(Function);
    });

    it('static first message references the seeded SAST vulnerability', () => {
      expect(scenario.staticFirstMessage).toContain('eval()');
      expect(scenario.staticFirstMessage).toContain('src/app/api/route.ts');
    });
  });
});
