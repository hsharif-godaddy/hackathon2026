import { describe, it, expect, vi } from 'vitest';
import { createGoldenLightScenario }
  from '../create-golden-light-scenario.js';
import type { GoldenLightConfig }
  from '../create-golden-light-scenario.js';
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

function makeBaseConfig(): GoldenLightConfig {
  return {
    name: 'test-scenario',
    goals: [{ description: 'test goal', assertion: 'positive' }],
  };
}

function makeMockEvaluator(name: string): Evaluator {
  return {
    name,
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

describe('createGoldenLightScenario', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  it('uses standardPersona when no persona override provided', () => {
    const scenario = createGoldenLightScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.persona).toBe(standardPersona);
  });

  it('uses provided persona override', () => {
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), persona: beginnerPersona },
      gocode,
      ctrlPlane,
    );
    expect(scenario.persona).toBe(beginnerPersona);
  });

  it("defaults suite to 'golden-light' when not provided", () => {
    const scenario = createGoldenLightScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('golden-light');
  });

  it('uses suite override when provided', () => {
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), suite: 'custom-suite' },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('custom-suite');
  });

  it('omits suite when suite is null', () => {
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), suite: null },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBeUndefined();
  });

  it("defaults suite to 'golden-light' when suite is explicitly undefined", () => {
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), suite: undefined },
      gocode,
      ctrlPlane,
    );
    expect(scenario.suite).toBe('golden-light');
  });

  it('defaults trials to 3', () => {
    const scenario = createGoldenLightScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.trials).toBe(3);
  });

  it('allows trials override', () => {
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), trials: 7 },
      gocode,
      ctrlPlane,
    );
    expect(scenario.trials).toBe(7);
  });

  it('prepends extraEvaluators before standard evaluators', () => {
    const extra = makeMockEvaluator('my-extra');
    const scenario = createGoldenLightScenario(
      { ...makeBaseConfig(), extraEvaluators: [extra] },
      gocode,
      ctrlPlane,
    );
    expect(scenario.evaluators[0].name).toBe('my-extra');
    expect(scenario.evaluators.map((e: Evaluator) => e.name)).toContain('bug-hit-rate');
  });

  it('includes agent-steps evaluator with raw step count score', async () => {
    const scenario = createGoldenLightScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    const agentStepsEval = scenario.evaluators.find(
      (e: Evaluator) => e.name === 'agent-steps',
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
      captureErrors: [],
    };
    const result = await agentStepsEval!.evaluate(transcript, scenario);
    expect(result.score).toBe(5);
    expect(result.verdict).toBe('observed');
  });

  describe('config validation', () => {
    it('throws RangeError when trials is 0', () => {
      expect(() => createGoldenLightScenario(
        { ...makeBaseConfig(), trials: 0 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is NaN', () => {
      expect(() => createGoldenLightScenario(
        { ...makeBaseConfig(), trials: NaN },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is Infinity', () => {
      expect(() => createGoldenLightScenario(
        { ...makeBaseConfig(), trials: Infinity },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });

    it('throws RangeError when trials is negative', () => {
      expect(() => createGoldenLightScenario(
        { ...makeBaseConfig(), trials: -1 },
        gocode,
        ctrlPlane,
      )).toThrow(RangeError);
    });
  });

  it('leaves staticFirstMessage undefined when not provided in config', () => {
    const scenario = createGoldenLightScenario(
      makeBaseConfig(),
      gocode,
      ctrlPlane,
    );
    expect(scenario.staticFirstMessage).toBeUndefined();
  });

  describe('setup return value', () => {
    it('returns appId and previewUrl from provisionApp', async () => {
      const scenario = createGoldenLightScenario(
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
      const scenario = createGoldenLightScenario(
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
        .mockImplementation(function () {});
      let deleteCalled = false;
      const spyCtrlPlane = makeSpyCtrlPlane(() => { deleteCalled = true; });
      const scenario = createGoldenLightScenario(
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
