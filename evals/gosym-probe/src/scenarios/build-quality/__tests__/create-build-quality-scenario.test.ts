import { describe, it, expect, vi } from 'vitest';
import { createBuildQualityScenario }
  from '../create-build-quality-scenario.js';
import type { BuildQualityConfig }
  from '../create-build-quality-scenario.js';
import { standardPersona } from '../../../personas/standard.js';
import { beginnerPersona } from '../../../personas/beginner.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { EvalResult, Evaluator }
  from '../../../evaluators/evaluator.js';
import type { Transcript, DOMSnapshot }
  from '../../../runner/transcript.js';
import type { Scenario } from '../../types.js';

function makeBaseConfig(): BuildQualityConfig {
  return {
    name: 'test-scenario',
    goals: [{ description: 'test goal', assertion: 'positive' }],
    agentStepBudget: 10,
    maxTurns: 5,
  };
}

function makeMockEvaluator(name: string): Evaluator {
  return {
    name,
    deterministic: true,
    evaluate: async (
      _transcript: Transcript,
      _scenario: Scenario,
      _snapshot?: DOMSnapshot,
    ): Promise<EvalResult> => ({
      evaluator: name,
      score: 1.0,
      verdict: 'pass',
      reason: 'mock',
    }),
  };
}

describe('createBuildQualityScenario', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  it('sets maxTurns from config', () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), maxTurns: 12 },
      gocode,
      ctrlPlane,
    );
    expect(scenario.maxTurns).toBe(12);
  });

  it('uses standardPersona when no persona override provided', () => {
    const scenario = createBuildQualityScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.persona).toBe(standardPersona);
  });

  it('uses provided persona override', () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), persona: beginnerPersona },
      gocode,
      ctrlPlane,
    );
    expect(scenario.persona).toBe(beginnerPersona);
  });

  it("defaults suite to 'build-quality' when not provided", () => {
    const scenario = createBuildQualityScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('build-quality');
  });

  it('uses suite override when provided', () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), suite: 'custom-suite' },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('custom-suite');
  });

  it('omits suite when suite is null', () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), suite: null },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBeUndefined();
  });

  it("defaults suite to 'build-quality' when suite is explicitly undefined", () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), suite: undefined },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('build-quality');
  });

  it("defaults category to 'capability'", () => {
    const scenario = createBuildQualityScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.category).toBe('capability');
  });

  it("allows category override to 'regression'", () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), category: 'regression' },
      gocode,
      ctrlPlane,
    );
    expect(scenario.category).toBe('regression');
  });

  it('defaults trials to 3', () => {
    const scenario = createBuildQualityScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.trials).toBe(3);
  });

  it('allows trials override', () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), trials: 7 },
      gocode,
      ctrlPlane,
    );
    expect(scenario.trials).toBe(7);
  });

  it('prepends extraEvaluators before standard evaluators', () => {
    const extra = makeMockEvaluator('my-extra');
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), extraEvaluators: [extra] },
      gocode,
      ctrlPlane,
    );
    expect(scenario.evaluators[0].name).toBe('my-extra');
    expect(scenario.evaluators.map((e) => e.name)).toContain('bug-hit-rate');
  });

  it('passes agentStepBudget to AgentStepsEvaluator as maxSteps', async () => {
    const scenario = createBuildQualityScenario(
      { ...makeBaseConfig(), agentStepBudget: 10 },
      gocode,
      ctrlPlane,
    );
    const agentStepsEval = scenario.evaluators.find(
      (e) => e.name === 'agent-steps',
    );
    expect(agentStepsEval).toBeDefined();

    const transcript: Transcript = {
      scenarioName: 'test',
      trialIndex: 0,
      turns: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [],
          timestamp: 0,
          totalSteps: 5,
        },
      ],
      snapshots: [],
      errors: [],
    };
    // score = Math.max(0, 1 - 5/10) = 0.5
    const result = await agentStepsEval!.evaluate(
      transcript, scenario,
    );
    expect(result.score).toBeCloseTo(0.5);
  });

  describe('config validation', () => {
    it('throws RangeError when agentStepBudget is 0', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), agentStepBudget: 0 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when maxTurns is 0', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), maxTurns: 0 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is 0', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), trials: 0 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when agentStepBudget is negative', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), agentStepBudget: -1 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when agentStepBudget is NaN', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), agentStepBudget: NaN },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when maxTurns is NaN', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), maxTurns: NaN },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is NaN', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), trials: NaN },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when agentStepBudget is Infinity', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), agentStepBudget: Infinity },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when maxTurns is Infinity', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), maxTurns: Infinity },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is Infinity', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), trials: Infinity },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when maxTurns is negative', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), maxTurns: -1 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is negative', () => {
      expect(() => createBuildQualityScenario(
        { ...makeBaseConfig(), trials: -1 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });
  });

  it('leaves staticFirstMessage undefined when not provided in config', () => {
    const scenario = createBuildQualityScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.staticFirstMessage).toBeUndefined();
  });

  describe('setup return value', () => {
    it('returns appId and previewUrl from provisionApp', async () => {
      const scenario = createBuildQualityScenario(
        makeBaseConfig(),
        gocode,
        ctrlPlane,
      );
      const ctx = await scenario.setup?.();
      expect(ctx).toEqual({
        appId: 'test-app',
        previewUrl: 'http://test',
      });
    });
  });

  describe('teardown type guard', () => {
    function makeSpyCtrlPlane(onDelete: (id: string) => void): AABCtrlPlaneClient {
      return {
        provisionApp: async () => ({ appId: 'test-app', previewUrl: 'http://test' }),
        deleteApp: async (id: string) => { onDelete(id); },
      } as unknown as AABCtrlPlaneClient;
    }

    it('calls deleteApp when appId is a string', async () => {
      let deletedId: string | undefined;
      const spyCtrlPlane = makeSpyCtrlPlane((id) => { deletedId = id; });
      const scenario = createBuildQualityScenario(
        makeBaseConfig(),
        gocode,
        spyCtrlPlane,
      );
      await scenario.teardown?.({ appId: 'my-app-id' });
      expect(deletedId).toBe('my-app-id');
    });

    it('does not call deleteApp or warn when appId is absent', async () => {
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      let deleteCalled = false;
      const spyCtrlPlane = makeSpyCtrlPlane(() => { deleteCalled = true; });
      const scenario = createBuildQualityScenario(
        makeBaseConfig(),
        gocode,
        spyCtrlPlane,
      );
      await scenario.teardown?.({});
      expect(deleteCalled).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
