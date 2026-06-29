import { describe, it, expect } from 'vitest';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type {
  ComparedRegressionEvalResult,
  RegressionResult,
  SkippedRegressionEvalResult,
} from '../../baselines/types.js';
import { makeScenarioResult, makeTrial, makeTurnWithToolCalls, makeToolCall } from './fixtures.js';
import {
  computeVerdict,
  renderHealthLine,
  renderScenarioOverview,
  renderVerdictHeader,
  renderVerdictMarkdown,
  type RunVerdict,
  type VerdictHeaderContext,
  type VerdictProvenance,
} from '../verdict.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeComparedEval(
  overrides: Partial<ComparedRegressionEvalResult> = {},
): ComparedRegressionEvalResult {
  return {
    type: 'compared',
    evaluator: 'jtbd-completion',
    currentScore: 0.9,
    baselineScore: 1.0,
    delta: -0.1,
    exceeded: false,
    ...overrides,
  };
}

function makeSkippedEval(
  overrides: Partial<SkippedRegressionEvalResult> = {},
): SkippedRegressionEvalResult {
  return {
    type: 'skipped',
    evaluator: 'jtbd-completion',
    skipReason: 'evaluator-version-mismatch',
    ...overrides,
  };
}

function makeRegression(
  gate: 'pass' | 'warning' | 'fail',
  overrides: Partial<RegressionResult> = {},
): RegressionResult {
  return {
    scenarioName: 'build-landing-page',
    gate,
    stabilityLevel: 'medium',
    evaluators: [makeComparedEval()],
    ...overrides,
  };
}

function makeScenarioWithGate(
  name: string,
  gate: 'pass' | 'warning' | 'fail',
  evaluators?: RegressionResult['evaluators'],
): ScenarioResult {
  return makeScenarioResult({
    scenarioName: name,
    regressionStatus: makeRegression(gate, {
      scenarioName: name,
      ...(evaluators ? { evaluators } : {}),
    }),
  });
}

const PROVENANCE: VerdictProvenance = {
  runId: '20260622172006_2b0a87b1',
  gitSha: '160c79d',
  gitBranch: 'main',
  generatedAt: '2026-06-25T00:00:00.000Z',
};

// ── computeVerdict: overall precedence ────────────────────────────────────────

describe('computeVerdict overall precedence', () => {
  it('returns fail when any scenario fails, regardless of others', () => {
    const verdict: RunVerdict = computeVerdict(
      [
        makeScenarioWithGate('a', 'pass'),
        makeScenarioWithGate('b', 'fail'),
        makeScenarioWithGate('c', 'warning'),
      ],
      { runMode: 'eval' },
    );
    expect(verdict.overall).toBe('fail');
  });

  it('returns warning when no fail but at least one warning', () => {
    const verdict: RunVerdict = computeVerdict(
      [makeScenarioWithGate('a', 'pass'), makeScenarioWithGate('b', 'warning')],
      { runMode: 'eval' },
    );
    expect(verdict.overall).toBe('warning');
  });

  it('returns pass when all scenarios pass', () => {
    const verdict: RunVerdict = computeVerdict(
      [makeScenarioWithGate('a', 'pass'), makeScenarioWithGate('b', 'pass')],
      { runMode: 'eval' },
    );
    expect(verdict.overall).toBe('pass');
  });

  it('mirrors each scenario gate exactly into perScenario (no re-derivation)', () => {
    const verdict: RunVerdict = computeVerdict(
      [makeScenarioWithGate('a', 'pass'), makeScenarioWithGate('b', 'fail')],
      { runMode: 'eval' },
    );
    expect(verdict.perScenario.map((s) => [s.name, s.gate])).toEqual([
      ['a', 'pass'],
      ['b', 'fail'],
    ]);
  });
});

// ── computeVerdict: no-baseline pass^k fallback ───────────────────────────────

describe('computeVerdict no-baseline fallback', () => {
  it('warns unconditionally when no baseline exists (scenario is ungated)', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': {
          passingTrials: 5,
          totalTrials: 5,
          passAt1: 1.0,
          passAtK: [{ k: 5, value: 1.0 }],
          passHatK: [{ k: 5, value: 1.0 }],
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'graduation' });
    expect(verdict.overall).toBe('warning');
    expect(verdict.perScenario[0].gate).toBe('warning');
    expect(verdict.perScenario[0].reason).toMatch(/no baseline/i);
    expect(verdict.perScenario[0].drivingEvaluators).toEqual([]);
  });

  it('warns in eval mode too when no baseline exists and trials pass', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': {
          passingTrials: 3,
          totalTrials: 5,
          passAt1: 0.6,
          passAtK: [{ k: 5, value: 0.922 }],
          passHatK: [{ k: 5, value: 0.078 }],
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(verdict.overall).toBe('warning');
    expect(verdict.perScenario[0].gate).toBe('warning');
  });

  it('fails an eval-mode scenario whose pass-rate evaluator passed zero trials (total miss)', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': {
          passingTrials: 0,
          totalTrials: 5,
          passAt1: 0,
          passAtK: [{ k: 5, value: 0 }],
          passHatK: [{ k: 5, value: 0 }],
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(verdict.overall).toBe('fail');
    expect(verdict.perScenario[0].gate).toBe('fail');
    expect(verdict.perScenario[0].drivingEvaluators).toContain('jtbd-completion');
    expect(verdict.perScenario[0].reason).toMatch(/zero passing trials/i);
  });

  it('keeps a graduation-mode total miss at warning (informational, never fail)', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': {
          passingTrials: 0,
          totalTrials: 5,
          passAt1: 0,
          passAtK: [{ k: 5, value: 0 }],
          passHatK: [{ k: 5, value: 0 }],
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'graduation' });
    expect(verdict.perScenario[0].gate).toBe('warning');
  });

  it('keeps an eval-mode partial miss at warning (some trials passed)', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': {
          passingTrials: 2,
          totalTrials: 5,
          passAt1: 0.4,
          passAtK: [{ k: 5, value: 0.922 }],
          passHatK: [{ k: 5, value: 0.01 }],
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(verdict.perScenario[0].gate).toBe('warning');
  });
});

// ── computeVerdict: driving evaluators + reasons ──────────────────────────────

describe('computeVerdict driving evaluators', () => {
  it('lists exceeded compared evaluators as driving a fail', () => {
    const verdict: RunVerdict = computeVerdict(
      [
        makeScenarioWithGate('a', 'fail', [
          makeComparedEval({ evaluator: 'token-usage', exceeded: true }),
          makeComparedEval({ evaluator: 'jtbd-completion', exceeded: false }),
        ]),
      ],
      { runMode: 'eval' },
    );
    expect(verdict.perScenario[0].drivingEvaluators).toEqual(['token-usage']);
  });

  it('lists version-mismatch skipped evaluators as driving a fail', () => {
    const verdict: RunVerdict = computeVerdict(
      [
        makeScenarioWithGate('a', 'fail', [
          makeSkippedEval({ evaluator: 'prompt-efficiency' }),
        ]),
      ],
      { runMode: 'eval' },
    );
    expect(verdict.perScenario[0].drivingEvaluators).toContain('prompt-efficiency');
  });
});

// ── computeVerdict: edge cases ────────────────────────────────────────────────

describe('computeVerdict edge cases', () => {
  it('returns pass with empty perScenario for 0 scenarios', () => {
    const verdict: RunVerdict = computeVerdict([], { runMode: 'eval' });
    expect(verdict.overall).toBe('pass');
    expect(verdict.perScenario).toEqual([]);
  });

  it('handles a single failing scenario', () => {
    const verdict: RunVerdict = computeVerdict([makeScenarioWithGate('only', 'fail')], {
      runMode: 'eval',
    });
    expect(verdict.overall).toBe('fail');
    expect(verdict.perScenario).toHaveLength(1);
  });

  it('handles mixed gates across many scenarios', () => {
    const verdict: RunVerdict = computeVerdict(
      [
        makeScenarioWithGate('a', 'pass'),
        makeScenarioWithGate('b', 'warning'),
        makeScenarioWithGate('c', 'pass'),
        makeScenarioWithGate('d', 'warning'),
      ],
      { runMode: 'eval' },
    );
    expect(verdict.overall).toBe('warning');
    expect(verdict.perScenario).toHaveLength(4);
  });

  it('treats a no-baseline score-mode evaluator as informational (warning, not fail)', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'score-only',
      aggregated: {
        'token-usage': {
          passingTrials: 0,
          totalTrials: 5,
          regressionMode: 'score',
          aggregateScore: 1234,
          lowerIsBetter: true,
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(verdict.perScenario[0].gate).toBe('warning');
  });

  it('does not let dropped trials change the authoritative gate', () => {
    const result: ScenarioResult = makeScenarioWithGate('with-drops', 'pass');
    result.droppedTrials = 3;
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(verdict.perScenario[0].gate).toBe('pass');
  });
});

// ── renderVerdictMarkdown ─────────────────────────────────────────────────────

describe('renderVerdictMarkdown', () => {
  it('renders a RESULT line matching the overall gate', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('a', 'fail')];
    const md: string = renderVerdictMarkdown(
      results,
      computeVerdict(results, { runMode: 'eval' }),
      PROVENANCE,
    );
    expect(md).toMatch(/RESULT:\s*FAIL/);
  });

  it('renders PASS for an all-pass run', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('a', 'pass')];
    const md: string = renderVerdictMarkdown(
      results,
      computeVerdict(results, { runMode: 'eval' }),
      PROVENANCE,
    );
    expect(md).toMatch(/RESULT:\s*PASS/);
  });

  it('includes each scenario name and provenance fields', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('build-landing-page', 'warning')];
    const md: string = renderVerdictMarkdown(
      results,
      computeVerdict(results, { runMode: 'eval' }),
      PROVENANCE,
    );
    expect(md).toContain('build-landing-page');
    expect(md).toContain(PROVENANCE.runId);
    expect(md).toContain('160c79d');
    expect(md).toContain('main');
  });

  it('renders a Scenario Overview table above the per-scenario detail', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('build-landing-page', 'warning')];
    const md: string = renderVerdictMarkdown(
      results,
      computeVerdict(results, { runMode: 'eval' }),
      PROVENANCE,
    );
    expect(md).toContain('## Scenario Overview');
    expect(md).toContain('| Scenario | Verdict | Driving Evaluators | Key Pass Rates |');
    expect(md.indexOf('## Scenario Overview')).toBeLessThan(md.indexOf('## Provenance'));
  });

  it('is deterministic byte-for-byte for identical inputs', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('a', 'pass')];
    const verdict: RunVerdict = computeVerdict(results, { runMode: 'eval' });
    const first: string = renderVerdictMarkdown(results, verdict, PROVENANCE);
    const second: string = renderVerdictMarkdown(results, verdict, PROVENANCE);
    expect(first).toBe(second);
  });
});

// ── renderVerdictHeader ───────────────────────────────────────────────────────

describe('renderVerdictHeader', () => {
  const CONTEXT: VerdictHeaderContext = {
    runId: '20260622172006_2b0a87b1',
    gitSha: '160c79d',
    gitBranch: 'main',
    generatedAt: '2026-06-25T00:00:00.000Z',
  };

  it('computes the verdict and renders the same markdown as the manual sequence', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('build-landing-page', 'fail')];
    const provenance: VerdictProvenance = { ...CONTEXT };
    const expected: string = renderVerdictMarkdown(
      results,
      computeVerdict(results, { runMode: 'eval' }),
      provenance,
    );
    expect(renderVerdictHeader(results, 'eval', CONTEXT)).toBe(expected);
  });

  it('threads optional LLM provenance into the rendered header', () => {
    const results: ScenarioResult[] = [makeScenarioWithGate('a', 'pass')];
    const header: string = renderVerdictHeader(results, 'eval', CONTEXT, {
      model: 'claude-opus-4-8',
      promptVersion: '3',
      payloadSha: 'abc123',
    });
    expect(header).toContain('model: claude-opus-4-8');
    expect(header).toContain('promptVersion: 3');
    expect(header).toContain('payloadSha: abc123');
  });

  it('passes runMode through to the no-baseline verdict (eval total miss fails)', () => {
    const results: ScenarioResult[] = [
      makeScenarioResult({
        scenarioName: 'no-baseline-scenario',
        aggregated: {
          'jtbd-completion': { passingTrials: 0, totalTrials: 5, passAt1: 0, passAtK: [{ k: 5, value: 0 }], passHatK: [{ k: 5, value: 0 }] },
        },
      }),
    ];
    expect(renderVerdictHeader(results, 'eval', CONTEXT)).toMatch(/RESULT:\s*FAIL/);
    expect(renderVerdictHeader(results, 'graduation', CONTEXT)).toMatch(/RESULT:\s*WARNING/);
  });
});

// ── renderHealthLine ──────────────────────────────────────────────────────────

function makeNoToolCallTrial(index: number): TrialResult {
  return makeTrial({
    trialIndex: index,
    transcript: {
      scenarioName: 'no-baseline-scenario',
      trialIndex: index,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
  });
}

function makeToolCallTrial(index: number): TrialResult {
  return makeTrial({
    trialIndex: index,
    transcript: {
      scenarioName: 'no-baseline-scenario',
      trialIndex: index,
      turns: [makeTurnWithToolCalls([makeToolCall(false)])],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
  });
}

describe('renderHealthLine', () => {
  it('counts zero-tool-call trials and reports the percentage', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      trials: [makeNoToolCallTrial(0), makeNoToolCallTrial(1), makeToolCallTrial(2)],
      aggregated: {
        'jtbd-completion': { passingTrials: 1, totalTrials: 3, passAt1: 0.333, passAtK: [{ k: 3, value: 0.704 }], passHatK: [{ k: 3, value: 0.037 }] },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    const line: string = renderHealthLine([result], verdict) ?? '';
    expect(line).toContain('2 of 3 trials (67%) made zero tool calls');
    expect(line).toContain('1 of 1 scenario non-passing');
  });

  it('returns null when every scenario passes and every trial called a tool', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'clean',
      trials: [makeToolCallTrial(0)],
      regressionStatus: makeRegression('pass', { scenarioName: 'clean' }),
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(renderHealthLine([result], verdict)).toBeNull();
  });

  it('returns null when there are no trials at all', () => {
    const result: ScenarioResult = makeScenarioWithGate('empty', 'pass');
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    expect(renderHealthLine([result], verdict)).toBeNull();
  });
});

// ── renderScenarioOverview ────────────────────────────────────────────────────

describe('renderScenarioOverview', () => {
  it('renders one table row per scenario with verdict and pass rates', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'no-baseline-scenario',
      aggregated: {
        'jtbd-completion': { passingTrials: 8, totalTrials: 20, passAt1: 0.4, passAtK: [{ k: 5, value: 0.922 }], passHatK: [{ k: 5, value: 0.078 }] },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    const md: string = renderScenarioOverview([result], verdict) ?? '';
    expect(md).toContain('| no-baseline-scenario | WARNING | — | — |');
  });

  it('renders the aggregate score when a score-mode evaluator drives the verdict', () => {
    const result: ScenarioResult = makeScenarioResult({
      scenarioName: 'score-driven',
      regressionStatus: makeRegression('fail', {
        scenarioName: 'score-driven',
        evaluators: [makeComparedEval({ evaluator: 'token-usage', exceeded: true })],
      }),
      aggregated: {
        'token-usage': {
          passingTrials: 0,
          totalTrials: 5,
          regressionMode: 'score',
          aggregateScore: 1234.5,
          lowerIsBetter: true,
        },
      },
    });
    const verdict: RunVerdict = computeVerdict([result], { runMode: 'eval' });
    const md: string = renderScenarioOverview([result], verdict) ?? '';
    expect(md).toContain('token-usage score 1234.500');
  });

  it('returns null when there are no scenarios', () => {
    const verdict: RunVerdict = computeVerdict([], { runMode: 'eval' });
    expect(renderScenarioOverview([], verdict)).toBeNull();
  });
});
