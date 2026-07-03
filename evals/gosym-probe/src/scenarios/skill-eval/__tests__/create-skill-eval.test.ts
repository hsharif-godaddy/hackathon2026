import { describe, it, expect, vi } from 'vitest';

import { createSkillEval, SKILL_EVAL_MIN_TRIALS } from '../create-skill-eval.js';
import type { SkillEvalConfig } from '../create-skill-eval.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { SkillInstruction } from '../../types.js';
import type { Evaluator } from '../../../evaluators/evaluator.js';
import type { StatefulAppOptions, SummarySeeder }
  from '../../stateful/create-stateful-app.js';

function stubGocode(): IGocodeClient {
  return {
    chat: vi.fn(),
    chatJson: vi.fn(),
    getModel: () => 'test-model',
    resetAccumulatedUsage: vi.fn(),
    withModel: vi.fn(),
    getAccumulatedUsage: vi.fn().mockReturnValue({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }),
  } as unknown as IGocodeClient;
}

function stubCtrlPlane(): AABCtrlPlaneClient {
  return {
    provisionApp: vi.fn(),
    deleteApp: vi.fn(),
  } as unknown as AABCtrlPlaneClient;
}

function validInstructions(): [SkillInstruction, ...SkillInstruction[]] {
  return [
    { id: 'instr-1', instruction: 'Use React Helmet for SEO', priority: 'required' },
    { id: 'instr-2', instruction: 'Include alt text on images', priority: 'advisory' },
  ];
}

function validConfig(
  overrides: Partial<SkillEvalConfig> = {},
): SkillEvalConfig {
  return {
    name: 'test-scenario',
    skill: 'inbox',
    userIntent: 'I want a contact page',
    goals: [{ description: 'Agent loads inbox skill', assertion: 'positive' }],
    skillInstructions: validInstructions(),
    ...overrides,
  };
}

describe('createSkillEval', () => {
  const gocode = stubGocode();
  const ctrlPlane = stubCtrlPlane();

  describe('validation boundary tests', () => {
    it('throws on empty skill', () => {
      expect(() => createSkillEval(
        validConfig({ skill: '' }),
        gocode,
        ctrlPlane,
      )).toThrow(/skill/i);
    });

    it('throws on empty userIntent', () => {
      expect(() => createSkillEval(
        validConfig({ userIntent: '' }),
        gocode,
        ctrlPlane,
      )).toThrow(/userIntent/i);
    });

    it('throws on trials = 0', () => {
      expect(() => createSkillEval(
        validConfig({ trials: 0 }),
        gocode,
        ctrlPlane,
      )).toThrow(/trials/i);
    });

    it('throws on negative trials', () => {
      expect(() => createSkillEval(
        validConfig({ trials: -1 }),
        gocode,
        ctrlPlane,
      )).toThrow(/trials/i);
    });

    it('throws on NaN trials', () => {
      expect(() => createSkillEval(
        validConfig({ trials: NaN }),
        gocode,
        ctrlPlane,
      )).toThrow(/trials/i);
    });

    it('throws on Infinity trials', () => {
      expect(() => createSkillEval(
        validConfig({ trials: Infinity }),
        gocode,
        ctrlPlane,
      )).toThrow(/trials/i);
    });

    it('throws on non-integer trials', () => {
      expect(() => createSkillEval(
        validConfig({ trials: 5.5 }),
        gocode,
        ctrlPlane,
      )).toThrow(/integer/i);
    });

    it(`throws when trials is below the k>=${SKILL_EVAL_MIN_TRIALS} floor`, () => {
      expect(() => createSkillEval(
        validConfig({ trials: SKILL_EVAL_MIN_TRIALS - 1 }),
        gocode,
        ctrlPlane,
      )).toThrow(/trials >=/i);
    });

    it(`accepts trials exactly at the k=${SKILL_EVAL_MIN_TRIALS} floor`, () => {
      expect(() => createSkillEval(
        validConfig({ trials: SKILL_EVAL_MIN_TRIALS }),
        gocode,
        ctrlPlane,
      )).not.toThrow();
    });

    it('throws on duplicate skillInstruction IDs', () => {
      expect(() => createSkillEval(
        validConfig({
          skillInstructions: [
            { id: 'dup', instruction: 'First', priority: 'required' },
            { id: 'dup', instruction: 'Second', priority: 'advisory' },
          ],
        }),
        gocode,
        ctrlPlane,
      )).toThrow(/duplicate.*dup/i);
    });

    it('throws when no required instruction is present (advisory-only cannot gate)', () => {
      expect(() => createSkillEval(
        validConfig({
          skillInstructions: [
            { id: 'a1', instruction: 'nice to have', priority: 'advisory' },
            { id: 'a2', instruction: 'also nice', priority: 'advisory' },
          ],
        }),
        gocode,
        ctrlPlane,
      )).toThrow(/at least one 'required'/i);
    });

    it('does not throw on valid config with no optional fields', () => {
      expect(() => createSkillEval(
        validConfig(),
        gocode,
        ctrlPlane,
      )).not.toThrow();
    });
  });

  describe('evaluator composition (seam tests)', () => {
    it('always includes SkillSelectionEvaluator', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('skill-selection');
    });

    it('always includes SkillOutcomeEvaluator', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('skill-outcome');
    });

    it('includes ExpectedArtifactMatchEvaluator when expectedArtifact provided', () => {
      const scenario = createSkillEval(
        validConfig({
          expectedArtifact: {
            intent: 'Contact page with form',
            items: [
              {
                id: 'has-form',
                description: 'Page has a contact form',
                type: 'capability',
                domMatcher: () => true,
              },
            ],
            evalVersion: '1',
          },
        }),
        gocode,
        ctrlPlane,
      );
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('expected-artifact-match');
      expect(names).toContain('narrow-artifact-judge');
    });

    it('does not include artifact evaluators when expectedArtifact absent', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).not.toContain('expected-artifact-match');
      expect(names).not.toContain('narrow-artifact-judge');
    });

    it('always includes built-in evaluators (JTBD, etc.)', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('jtbd-completion');
      expect(names).toContain('bug-hit-rate');
      expect(names).toContain('prompt-efficiency');
    });

    it('throws on duplicate evaluator names from extraEvaluators', () => {
      const dupe: Evaluator = {
        name: 'skill-selection',
        comparisonMode: 'passRate' as const,
        evaluate: vi.fn(),
      };
      expect(() => createSkillEval(
        validConfig({ extraEvaluators: [dupe] }),
        gocode,
        ctrlPlane,
      )).toThrow(/duplicate/i);
    });
  });

  describe('field passthrough (seam tests)', () => {
    it('sets staticFirstMessage from userIntent', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.staticFirstMessage).toBe('I want a contact page');
    });

    it('sets expectedSkills from config skill', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.expectedSkills).toEqual(['inbox']);
    });

    it('sets skillInstructions on the scenario', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.skillInstructions).toEqual(validInstructions());
    });

    it('forwards expectedAgent', () => {
      const scenario = createSkillEval(
        validConfig({ expectedAgent: 'AI Developer' }),
        gocode,
        ctrlPlane,
      );
      expect(scenario.expectedAgent).toBe('AI Developer');
    });

    it('forwards expectedTools', () => {
      const tools = [{ tool: 'write_file', called: true }];
      const scenario = createSkillEval(
        validConfig({ expectedTools: tools }),
        gocode,
        ctrlPlane,
      );
      expect(scenario.expectedTools).toEqual(tools);
    });

    it('defaults suite to skill-eval', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.suite).toBe('skill-eval');
    });

    it('allows suite override', () => {
      const scenario = createSkillEval(
        validConfig({ suite: 'custom-suite' }),
        gocode,
        ctrlPlane,
      );
      expect(scenario.suite).toBe('custom-suite');
    });

    it('uses scenario name from config', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.name).toBe('test-scenario');
    });

    it(`defaults trials to the k=${SKILL_EVAL_MIN_TRIALS} floor when unset`, () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.trials).toBe(SKILL_EVAL_MIN_TRIALS);
    });

    it('honors an explicit trials override at or above the floor', () => {
      const scenario = createSkillEval(
        validConfig({ trials: 10 }),
        gocode,
        ctrlPlane,
      );
      expect(scenario.trials).toBe(10);
    });
  });

  describe('stateful injection seam tests', () => {
    function makeStatefulCtrlPlane(): AABCtrlPlaneClient {
      return {
        provisionApp: vi.fn().mockResolvedValue({
          appId: 'shared-app',
          previewUrl: 'http://shared',
        }),
        deleteApp: vi.fn().mockResolvedValue(undefined),
        resetApp: vi.fn().mockResolvedValue(undefined),
      } as unknown as AABCtrlPlaneClient;
    }

    it('sets requiresSerialTrials when statefulInjection is provided', () => {
      const injection: StatefulAppOptions = {
        existingApp: { appId: 'pre-built', previewUrl: 'http://pre' },
      };
      const scenario = createSkillEval(
        validConfig({ statefulInjection: injection }),
        gocode,
        makeStatefulCtrlPlane(),
      );
      expect(scenario.requiresSerialTrials).toBe(true);
    });

    it('does not set requiresSerialTrials when statefulInjection is absent', () => {
      const scenario = createSkillEval(validConfig(), gocode, ctrlPlane);
      expect(scenario.requiresSerialTrials).toBeUndefined();
    });

    it('seedSummary callback is invoked during setup when statefulInjection + seededSummary set', async () => {
      const seedSummaryMock: SummarySeeder = vi.fn().mockResolvedValue(undefined);
      const seedInput = {
        summaryText: 'A dental practice site with 6 pages',
        messageCount: 10,
        originalTokenCount: 2000,
      };
      const injection: StatefulAppOptions = {
        existingApp: { appId: 'pre-built', previewUrl: 'http://pre' },
        seededSummary: seedInput,
      };
      const scenario = createSkillEval(
        validConfig({ statefulInjection: injection }),
        gocode,
        makeStatefulCtrlPlane(),
        seedSummaryMock,
      );
      await scenario.setup?.();
      expect(seedSummaryMock).toHaveBeenCalledWith('pre-built', seedInput);
    });

    it('seedSummary without statefulInjection is a no-op (no error)', () => {
      const seedSummaryMock: SummarySeeder = vi.fn().mockResolvedValue(undefined);
      expect(() => createSkillEval(
        validConfig(),
        gocode,
        ctrlPlane,
        seedSummaryMock,
      )).not.toThrow();
    });

    it('fallback path (no injection) setup provisions a fresh app', async () => {
      const freshCtrl = makeStatefulCtrlPlane();
      const scenario = createSkillEval(validConfig(), gocode, freshCtrl);
      const ctx = await scenario.setup?.();
      expect(ctx).toEqual({ appId: 'shared-app', previewUrl: 'http://shared' });
      expect(freshCtrl.provisionApp).toHaveBeenCalledTimes(1);
    });

    it('fallback path (no injection) teardown deletes the app', async () => {
      const freshCtrl = makeStatefulCtrlPlane();
      const scenario = createSkillEval(validConfig(), gocode, freshCtrl);
      await scenario.teardown?.({ appId: 'shared-app' });
      expect(freshCtrl.deleteApp).toHaveBeenCalledWith('shared-app');
    });
  });
});
