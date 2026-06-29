import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import {
  makeScenarioResult,
  makeTrial,
  makeEvalResult,
  makeToolCall,
  makeTurnWithToolCalls,
} from './fixtures.js';
import {
  selectTrialsNeedingInvestigation,
  buildTrialEvidence,
  buildScenarioEvidence,
  type EvidenceCaps,
  type ScenarioEvidence,
  type TrialEvidence,
} from '../evidence.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'build-landing-page',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
    ...overrides,
  };
}

function trialWithVerdict(
  trialIndex: number,
  verdict: EvalResult['verdict'],
  transcriptOverrides: Partial<Transcript> = {},
): TrialResult {
  return makeTrial({
    trialIndex,
    transcript: makeTranscript({ trialIndex, ...transcriptOverrides }),
    evalResults: [makeEvalResult({ verdict, reason: `verdict ${verdict}` })],
  });
}

const NO_CAPS: EvidenceCaps = {
  maxInvestigatedTrialsPerScenario: 100,
  maxEvidenceCharsPerTrial: 100_000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ── selectTrialsNeedingInvestigation ─────────────────────────────────────────

describe('selectTrialsNeedingInvestigation', () => {
  it('selects trials with fail, partial, or unknown verdicts', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [
        trialWithVerdict(0, 'fail'),
        trialWithVerdict(1, 'partial'),
        trialWithVerdict(2, 'unknown'),
      ],
    });
    expect(selectTrialsNeedingInvestigation(result).map((t) => t.trialIndex)).toEqual([
      0, 1, 2,
    ]);
  });

  it('excludes clean trials with only passing verdicts', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [trialWithVerdict(0, 'pass'), trialWithVerdict(1, 'pass')],
    });
    expect(selectTrialsNeedingInvestigation(result)).toEqual([]);
  });

  it('excludes score-mode observed-only trials with no errors', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [trialWithVerdict(0, 'observed')],
    });
    expect(selectTrialsNeedingInvestigation(result)).toEqual([]);
  });

  it('selects a passing trial that recorded agent errors', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [trialWithVerdict(0, 'pass', { errors: ['boom'] })],
    });
    expect(selectTrialsNeedingInvestigation(result).map((t) => t.trialIndex)).toEqual([0]);
  });

  it('selects a passing trial that recorded capture errors', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [trialWithVerdict(0, 'pass', { captureErrors: ['playwright timeout'] })],
    });
    expect(selectTrialsNeedingInvestigation(result).map((t) => t.trialIndex)).toEqual([0]);
  });

  it('returns an empty array for a scenario with no trials', () => {
    expect(selectTrialsNeedingInvestigation(makeScenarioResult({ trials: [] }))).toEqual([]);
  });
});

// ── buildTrialEvidence: content ──────────────────────────────────────────────

describe('buildTrialEvidence content', () => {
  it('cites the on-disk trial artifact path', () => {
    const result: ScenarioResult = makeScenarioResult({ scenarioName: 'my-scenario' });
    const trial: TrialResult = trialWithVerdict(3, 'fail');
    const evidence: TrialEvidence = buildTrialEvidence(
      result,
      trial,
      NO_CAPS.maxEvidenceCharsPerTrial,
    );
    expect(evidence.artifactPath).toBe('scenarios/my-scenario/trials/3/');
    expect(evidence.markdown).toContain('scenarios/my-scenario/trials/3/');
  });

  it('summarizes tool calls including failed counts', () => {
    const trial: TrialResult = makeTrial({
      trialIndex: 0,
      transcript: makeTranscript({
        turns: [makeTurnWithToolCalls([makeToolCall(false), makeToolCall(true)])],
      }),
      evalResults: [makeEvalResult({ verdict: 'fail' })],
    });
    const evidence: TrialEvidence = buildTrialEvidence(
      makeScenarioResult(),
      trial,
      NO_CAPS.maxEvidenceCharsPerTrial,
    );
    expect(evidence.toolCalls.totalCount).toBe(2);
    expect(evidence.toolCalls.failedCount).toBe(1);
    expect(evidence.markdown).toMatch(/tool call/i);
  });

  it('includes transcript errors and captureErrors verbatim', () => {
    const trial: TrialResult = makeTrial({
      trialIndex: 0,
      transcript: makeTranscript({
        errors: ['agent crashed'],
        captureErrors: ['capture failed'],
      }),
      evalResults: [makeEvalResult({ verdict: 'fail' })],
    });
    const evidence: TrialEvidence = buildTrialEvidence(
      makeScenarioResult(),
      trial,
      NO_CAPS.maxEvidenceCharsPerTrial,
    );
    expect(evidence.errors).toEqual(['agent crashed']);
    expect(evidence.captureErrors).toEqual(['capture failed']);
    expect(evidence.markdown).toContain('agent crashed');
    expect(evidence.markdown).toContain('capture failed');
  });

  it('includes per-evaluator verdict and reason', () => {
    const trial: TrialResult = makeTrial({
      trialIndex: 0,
      transcript: makeTranscript(),
      evalResults: [
        makeEvalResult({ evaluator: 'jtbd-completion', verdict: 'fail', reason: 'task incomplete' }),
        makeEvalResult({ evaluator: 'bug-hit-rate', verdict: 'pass', reason: 'no bugs' }),
      ],
    });
    const evidence: TrialEvidence = buildTrialEvidence(
      makeScenarioResult(),
      trial,
      NO_CAPS.maxEvidenceCharsPerTrial,
    );
    expect(evidence.evaluatorVerdicts).toEqual([
      { evaluator: 'jtbd-completion', verdict: 'fail', reason: 'task incomplete' },
      { evaluator: 'bug-hit-rate', verdict: 'pass', reason: 'no bugs' },
    ]);
    expect(evidence.markdown).toContain('jtbd-completion');
    expect(evidence.markdown).toContain('task incomplete');
  });

  it('reports zero droppedChars when under the char cap', () => {
    const evidence: TrialEvidence = buildTrialEvidence(
      makeScenarioResult(),
      trialWithVerdict(0, 'fail'),
      NO_CAPS.maxEvidenceCharsPerTrial,
    );
    expect(evidence.droppedChars).toBe(0);
  });
});

// ── buildTrialEvidence: char cap ─────────────────────────────────────────────

describe('buildTrialEvidence char cap', () => {
  it('truncates markdown to the cap, records droppedChars, and logs the drop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const trial: TrialResult = makeTrial({
      trialIndex: 0,
      transcript: makeTranscript({ errors: ['x'.repeat(5000)] }),
      evalResults: [makeEvalResult({ verdict: 'fail' })],
    });
    const evidence: TrialEvidence = buildTrialEvidence(makeScenarioResult(), trial, 500);
    expect(evidence.markdown.length).toBeLessThanOrEqual(500);
    expect(evidence.droppedChars).toBeGreaterThan(0);
    expect(evidence.markdown).toMatch(/truncated/i);
    expect(warn).toHaveBeenCalled();
  });
});

// ── buildScenarioEvidence: trial cap ─────────────────────────────────────────

describe('buildScenarioEvidence', () => {
  it('builds evidence only for trials needing investigation', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [
        trialWithVerdict(0, 'pass'),
        trialWithVerdict(1, 'fail'),
        trialWithVerdict(2, 'pass'),
      ],
    });
    const evidence: ScenarioEvidence = buildScenarioEvidence(result, NO_CAPS);
    expect(evidence.trials.map((t) => t.trialIndex)).toEqual([1]);
    expect(evidence.droppedTrialCount).toBe(0);
  });

  it('caps investigated trials, records the dropped count, and logs the drop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result: ScenarioResult = makeScenarioResult({
      trials: [
        trialWithVerdict(0, 'fail'),
        trialWithVerdict(1, 'fail'),
        trialWithVerdict(2, 'fail'),
      ],
    });
    const evidence: ScenarioEvidence = buildScenarioEvidence(result, {
      maxInvestigatedTrialsPerScenario: 2,
      maxEvidenceCharsPerTrial: 100_000,
    });
    expect(evidence.trials).toHaveLength(2);
    expect(evidence.droppedTrialCount).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('returns empty evidence with zero drops for a clean scenario', () => {
    const result: ScenarioResult = makeScenarioResult({
      trials: [trialWithVerdict(0, 'pass')],
    });
    const evidence: ScenarioEvidence = buildScenarioEvidence(result, NO_CAPS);
    expect(evidence.trials).toEqual([]);
    expect(evidence.droppedTrialCount).toBe(0);
  });
});
