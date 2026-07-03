import { describe, it, expect } from 'vitest';
import { assessBaselineEligibility } from '../baseline-eligibility.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { Transcript, Turn } from '../../runner/transcript.js';

const USER_TURN: Turn = { role: 'user', content: 'build it', toolCalls: [], timestamp: 0 };
const AGENT_TURN: Turn = { role: 'assistant', content: 'done', toolCalls: [], timestamp: 1 };

function transcript(turns: Turn[]): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors: [],
    captureErrors: [],
  };
}

function trial(turns: Turn[], verdicts: EvalResult['verdict'][]): TrialResult {
  return {
    trialIndex: 0,
    transcript: transcript(turns),
    evalResults: verdicts.map((verdict) => ({
      evaluator: 'e',
      score: verdict === 'pass' ? 1 : 0,
      verdict,
      reason: '',
    })),
  };
}

function scenarioResult(trials: TrialResult[]): ScenarioResult {
  return { scenarioName: 'test', stabilityLevel: 'medium', trials, aggregated: {} };
}

describe('assessBaselineEligibility', () => {
  it('rejects a run with no trials', () => {
    const r = assessBaselineEligibility(scenarioResult([]));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('no-trials');
  });

  it('rejects a run where no trial produced an assistant turn', () => {
    // The turn-0 case: vacuous evaluators still emit pass on an empty build.
    const r = assessBaselineEligibility(
      scenarioResult([
        trial([USER_TURN], ['pass']),
        trial([USER_TURN], ['pass']),
      ]),
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('no-agent-output');
  });

  it('rejects a run with agent output but only incomplete verdicts', () => {
    const r = assessBaselineEligibility(
      scenarioResult([trial([USER_TURN, AGENT_TURN], ['incomplete', 'incomplete'])]),
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('all-incomplete-verdicts');
  });

  it('accepts a run with agent output and a comparable verdict (fail counts)', () => {
    const r = assessBaselineEligibility(
      scenarioResult([trial([USER_TURN, AGENT_TURN], ['fail'])]),
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('accepts when only some trials have output + verdicts', () => {
    const r = assessBaselineEligibility(
      scenarioResult([
        trial([USER_TURN], ['incomplete']),
        trial([USER_TURN, AGENT_TURN], ['pass']),
      ]),
    );
    expect(r.eligible).toBe(true);
  });
});
