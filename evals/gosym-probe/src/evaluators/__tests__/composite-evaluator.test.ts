import { describe, expect, it, vi } from 'vitest';

import type { AgentClient } from '../../clients/agent-client.js';
import type { Persona } from '../../personas/types.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { EvalResult, Evaluator } from '../evaluator.js';
import {
  CompositeEvaluator,
  type CompositeBreakdownEntry,
} from '../composite-evaluator.js';

// -------------------------------------------------------
// Fixture helpers
// -------------------------------------------------------

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeTranscript(): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
  };
}

function makeScenario(): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    category: 'capability',
  };
}

function makeSnapshot(): DOMSnapshot {
  return {
    url: 'https://localhost:8443',
    htmlPath: '/tmp/snap.html',
    screenshotPath: '/tmp/snap.png',
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
}

function stubEvaluator(
  name: string,
  result: EvalResult,
  opts: {
    hookClient?: (client: AgentClient, trialIndex: number) => void;
    afterSimulation?: (trialIndex: number) => void;
    unhookTrial?: (trialIndex: number) => void;
  } = {},
): Evaluator {
  return {
    name,
    evaluate: vi.fn().mockResolvedValue(result),
    ...opts,
  };
}

function passResult(name: string, score: number): EvalResult {
  return { evaluator: name, score, verdict: 'pass', reason: 'ok' };
}

function unknownResult(name: string): EvalResult {
  return { evaluator: name, score: 0, verdict: 'unknown', reason: 'n/a' };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe('CompositeEvaluator', () => {
  describe('identity properties', () => {
    it('exposes the configured name', () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [],
      });
      expect(composite.name).toBe('output-quality');
    });

    it('defaults regressionMode to "score"', () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [],
      });
      expect(composite.regressionMode).toBe('score');
    });

    it('accepts an explicit regressionMode', () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [],
        regressionMode: 'passRate',
      });
      expect(composite.regressionMode).toBe('passRate');
    });
  });

  describe('score aggregation', () => {
    it('returns the mean of 3 sub-evaluator scores', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.6)),
          stubEvaluator('b', passResult('b', 0.8)),
          stubEvaluator('c', passResult('c', 1.0)),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      // mean of 0.6, 0.8, 1.0 = 0.8
      expect(result.score).toBeCloseTo(0.8);
    });

    it('single sub-evaluator: score equals that sub-evaluator score', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('a', passResult('a', 0.75))],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.score).toBeCloseTo(0.75);
    });

    it('excludes unknown-verdict sub-evaluators from the average', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 1.0)),
          stubEvaluator('b', unknownResult('b')),
          stubEvaluator('c', passResult('c', 0.5)),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      // mean of 1.0 and 0.5 = 0.75 (unknown excluded)
      expect(result.score).toBeCloseTo(0.75);
    });

    it('excludes NaN scores from the average', async () => {
      const nanResult: EvalResult = {
        evaluator: 'nan-ev',
        score: NaN,
        verdict: 'fail',
        reason: 'bad',
      };
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.8)),
          stubEvaluator('nan-ev', nanResult),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.score).toBeCloseTo(0.8);
    });

    it('clamps the averaged score to [0, 1] when sub-scores exceed 1.0', async () => {
      // Simulate a sub-evaluator that bypasses normalization and returns > 1
      const overResult: EvalResult = {
        evaluator: 'over',
        score: 1.5,
        verdict: 'pass',
        reason: 'over',
      };
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('over', overResult),
          stubEvaluator('b', passResult('b', 1.0)),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
    });

    it('returns verdict: unknown when all sub-evaluators return unknown', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', unknownResult('a')),
          stubEvaluator('b', unknownResult('b')),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('returns verdict: unknown when sub-evaluators array is empty', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('assigns a verdict via scoreToVerdict for scoreable results', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        // mean = 0.9 → 'pass'
        subEvaluators: [stubEvaluator('a', passResult('a', 0.9))],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.verdict).toBe('pass');
    });
  });

  describe('error isolation', () => {
    it('catches a sub-evaluator that throws an Error', async () => {
      const throwing: Evaluator = {
        name: 'bad',
        evaluate: vi.fn().mockRejectedValue(new Error('boom')),
      };
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          throwing,
          stubEvaluator('good', passResult('good', 0.8)),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      // only 'good' contributes to the average
      expect(result.score).toBeCloseTo(0.8);
    });

    it('catches a sub-evaluator that throws a non-Error value', async () => {
      const throwing: Evaluator = {
        name: 'bad',
        evaluate: vi.fn().mockRejectedValue('string rejection'),
      };
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [throwing],
      });

      // Should not throw; all-unknown → verdict unknown
      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.verdict).toBe('unknown');
    });
  });

  describe('details shape', () => {
    it('sets details._composite to true', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('a', passResult('a', 0.9))],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.details?._composite).toBe(true);
    });

    it('details.breakdown contains an entry for each sub-evaluator', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9)),
          stubEvaluator('b', unknownResult('b')),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());
      const breakdown = result.details?.breakdown as CompositeBreakdownEntry[];

      expect(breakdown).toHaveLength(2);
      expect(breakdown[0].evaluator).toBe('a');
      expect(breakdown[1].evaluator).toBe('b');
    });

    it('breakdown entry has correct shape for a scoreable sub-evaluator', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('a', passResult('a', 0.9))],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());
      const entry = (result.details?.breakdown as CompositeBreakdownEntry[])[0];

      expect(entry.evaluator).toBe('a');
      expect(entry.score).toBeCloseTo(0.9);
      expect(entry.verdict).toBe('pass');
      expect(entry.reason).toBe('ok');
      expect(entry.scoreable).toBe(true);
    });

    it('breakdown entry marks unknown sub-evaluator as not scoreable', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('b', unknownResult('b'))],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());
      const entry = (result.details?.breakdown as CompositeBreakdownEntry[])[0];

      expect(entry.scoreable).toBe(false);
    });

    it('breakdown entry marks NaN-score sub-evaluator as not scoreable', async () => {
      const nanResult: EvalResult = {
        evaluator: 'nan-ev',
        score: NaN,
        verdict: 'fail',
        reason: 'bad',
      };
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('nan-ev', nanResult)],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());
      const entry = (result.details?.breakdown as CompositeBreakdownEntry[])[0];

      expect(entry.scoreable).toBe(false);
    });

    it('details.scoredCount and totalCount reflect correct counts', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9)),
          stubEvaluator('b', unknownResult('b')),
          stubEvaluator('c', passResult('c', 0.7)),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.details?.scoredCount).toBe(2);
      expect(result.details?.totalCount).toBe(3);
    });

    it('reason string mentions sub-evaluator counts', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9)),
          stubEvaluator('b', unknownResult('b')),
        ],
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.reason).toContain('1');
      expect(result.reason).toContain('2');
    });
  });

  describe('evalVersion', () => {
    it('attaches evalVersion to result when set in options', async () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [stubEvaluator('a', passResult('a', 0.8))],
        evalVersion: '1.0',
      });

      const result = await composite.evaluate(makeTranscript(), makeScenario());

      expect(result.evalVersion).toBe('1.0');
    });

    it('derives version from sub-evaluators when evalVersion not provided', () => {
      const evA: Evaluator = {
        name: 'alpha',
        evalVersion: '1.0',
        evaluate: vi.fn().mockResolvedValue(passResult('alpha', 0.8)),
      };
      const evB: Evaluator = {
        name: 'beta',
        evalVersion: '2.0',
        evaluate: vi.fn().mockResolvedValue(passResult('beta', 0.9)),
      };

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [evB, evA],
      });

      // sorted by name: alpha:1.0+beta:2.0
      expect(composite.evalVersion).toBe('alpha:1.0+beta:2.0');
    });

    it('explicit evalVersion overrides derivation', () => {
      const evA: Evaluator = {
        name: 'alpha',
        evalVersion: '1.0',
        evaluate: vi.fn().mockResolvedValue(passResult('alpha', 0.8)),
      };

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [evA],
        evalVersion: 'custom',
      });

      expect(composite.evalVersion).toBe('custom');
    });

    it('changing a sub-evaluator version changes composite version', () => {
      const evA: Evaluator = {
        name: 'alpha',
        evalVersion: '1.0',
        evaluate: vi.fn().mockResolvedValue(passResult('alpha', 0.8)),
      };
      const evB: Evaluator = {
        name: 'beta',
        evalVersion: '2.0',
        evaluate: vi.fn().mockResolvedValue(passResult('beta', 0.9)),
      };

      const compositeV1 = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [evA, evB],
      });

      const evBv3: Evaluator = {
        name: 'beta',
        evalVersion: '3.0',
        evaluate: vi.fn().mockResolvedValue(passResult('beta', 0.9)),
      };

      const compositeV2 = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [evA, evBv3],
      });

      expect(compositeV1.evalVersion).not.toBe(compositeV2.evalVersion);
    });

    it('returns undefined when no sub-evaluators and no explicit evalVersion', () => {
      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [],
      });

      expect(composite.evalVersion).toBeUndefined();
    });

    it('uses "0" for sub-evaluators without evalVersion', () => {
      const evNoVersion: Evaluator = {
        name: 'noversion',
        evaluate: vi.fn().mockResolvedValue(passResult('noversion', 0.8)),
      };

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [evNoVersion],
      });

      expect(composite.evalVersion).toBe('noversion:0');
    });
  });

  describe('lifecycle hook forwarding', () => {
    it('calls hookClient on all sub-evaluators that have it', () => {
      const hookA = vi.fn();
      const hookB = vi.fn();
      const noHookEv = stubEvaluator('c', passResult('c', 0.5));

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9), { hookClient: hookA }),
          stubEvaluator('b', passResult('b', 0.8), { hookClient: hookB }),
          noHookEv,
        ],
      });

      const mockClient = {} as AgentClient;
      composite.hookClient!(mockClient, 0);

      expect(hookA).toHaveBeenCalledWith(mockClient, 0);
      expect(hookB).toHaveBeenCalledWith(mockClient, 0);
    });

    it('calls afterSimulation on all sub-evaluators that have it', () => {
      const afterA = vi.fn();
      const noAfterEv = stubEvaluator('b', passResult('b', 0.8));

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9), { afterSimulation: afterA }),
          noAfterEv,
        ],
      });

      composite.afterSimulation!(2);

      expect(afterA).toHaveBeenCalledWith(2);
    });

    it('calls unhookTrial on all sub-evaluators that have it', () => {
      const unhookA = vi.fn();
      const unhookB = vi.fn();
      const noUnhookEv = stubEvaluator('c', passResult('c', 0.5));

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [
          stubEvaluator('a', passResult('a', 0.9), { unhookTrial: unhookA }),
          stubEvaluator('b', passResult('b', 0.8), { unhookTrial: unhookB }),
          noUnhookEv,
        ],
      });

      composite.unhookTrial!(1);

      expect(unhookA).toHaveBeenCalledWith(1);
      expect(unhookB).toHaveBeenCalledWith(1);
    });

    it('forwards snapshot to each sub-evaluator evaluate call', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue(passResult('a', 0.8));
      const subEv: Evaluator = {
        name: 'a',
        evaluate: mockEvaluate,
      };

      const composite = new CompositeEvaluator({
        name: 'output-quality',
        subEvaluators: [subEv],
      });

      const transcript = makeTranscript();
      const scenario = makeScenario();
      const snapshot = makeSnapshot();
      await composite.evaluate(transcript, scenario, snapshot);

      expect(mockEvaluate).toHaveBeenCalledWith(transcript, scenario, snapshot);
    });
  });
});
