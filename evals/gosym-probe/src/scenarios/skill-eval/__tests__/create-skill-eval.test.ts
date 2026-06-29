import { describe, it, expect, vi } from 'vitest';

import { createSkillEval } from '../create-skill-eval.js';
import type { SkillEvalConfig } from '../create-skill-eval.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { SkillInstruction } from '../../types.js';
import type { Evaluator } from '../../../evaluators/evaluator.js';

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
  });
});
