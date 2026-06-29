import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { ScenarioResult } from '../../runner/types.js';
import type {
  ComparedRegressionEvalResult,
  StatisticalMetadata,
} from '../../baselines/types.js';
import { makeScenarioResult, makeTrial, makeEvalResult } from './fixtures.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

import { readFile } from 'node:fs/promises';
import {
  NarrativeSummaryReporter,
  buildContextPayload,
} from '../narrative-summary.js';

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

function makeTostMetadata(
  overrides: Partial<StatisticalMetadata> = {},
): StatisticalMetadata {
  return {
    method: 'wilson-score',
    margin: 0.05,
    baselineSD: 0.1,
    k: 0.5,
    n: { baseline: 10, current: 10 },
    confidenceInterval: { lower: -0.12, upper: 0.02 },
    nonInferiorityProven: true,
    ...overrides,
  };
}

function makeResultWithRegression(
  baselineFilePath?: string,
): ScenarioResult {
  return makeScenarioResult({
    scenarioName: 'build-landing-page',
    stabilityLevel: 'medium',
    aggregated: {
      'jtbd-completion': {
        passingTrials: 9,
        totalTrials: 10,
        passAt1: 0.9,
        passAtK: [
          { k: 1, value: 0.9 },
          { k: 2, value: 0.99 },
          { k: 3, value: 0.9917 },
          { k: 5, value: 0.9994 },
        ],
        passHatK: [
          { k: 1, value: 0.9 },
          { k: 2, value: 0.8 },
          { k: 3, value: 0.7 },
          { k: 5, value: 0.5 },
        ],
      },
    },
    regressionStatus: {
      scenarioName: 'build-landing-page',
      gate: 'warning',
      stabilityLevel: 'medium',
      evaluators: [makeComparedEval()],
    },
    ...(baselineFilePath ? { baselineFilePath } : {}),
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let mockGocode: { complete: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
let reporter: NarrativeSummaryReporter;

beforeEach(() => {
  vi.resetAllMocks();
  mockGocode = {
    complete: vi.fn().mockResolvedValue('# Narrative\nAll good.'),
    getModel: vi.fn().mockReturnValue('base-model'),
  };
  reporter = new NarrativeSummaryReporter(mockGocode as unknown as IGocodeClient);
});

// ── buildContextPayload unit tests ────────────────────────────────────────────

describe('buildContextPayload', () => {
  it('includes run metadata header', () => {
    const payload = buildContextPayload('run-001', [], {
      runMode: 'eval',
      gitSha: 'abc1234',
      gitBranch: 'main',
      wallClockMs: 12345,
    });

    expect(payload).toContain('run-001');
    expect(payload).toContain('Mode: eval');
    expect(payload).toContain('Branch: main');
    expect(payload).toContain('Commit: abc1234');
    expect(payload).toContain('12.3s');
  });

  it('handles empty results without throwing', () => {
    const payload = buildContextPayload('run-002', [], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Scenarios: 0');
  });

  it('omits regression gate label when no regressionStatus', () => {
    const result = makeScenarioResult({ scenarioName: 'my-scenario' });
    const payload = buildContextPayload('run-003', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('(no baseline comparison)');
  });

  it('guards NaN in aggregateScore with N/A', () => {
    const result = makeScenarioResult({
      aggregated: {
        'token-usage': {
          passingTrials: 3,
          totalTrials: 3,
          regressionMode: 'score',
          aggregateScore: NaN,
        },
      },
    });

    const payload = buildContextPayload('run-004', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).not.toContain('NaN');
    expect(payload).toContain('N/A');
  });

  it('guards Infinity in aggregateScore with N/A', () => {
    const result = makeScenarioResult({
      aggregated: {
        'cost-evaluator': {
          passingTrials: 3,
          totalTrials: 3,
          regressionMode: 'score',
          aggregateScore: Infinity,
        },
      },
    });

    const payload = buildContextPayload('run-005', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).not.toContain('Infinity');
    expect(payload).toContain('N/A');
  });

  it('includes TOST metadata (CI, margin, n, nonInferiorityProven) when present', () => {
    const tost = makeTostMetadata({
      n: { baseline: 5, current: 5 },
      confidenceInterval: { lower: -0.03, upper: 0.08 },
      margin: 0.123,
      nonInferiorityProven: false,
    });
    const result = makeScenarioResult({
      aggregated: {
        'jtbd-completion': { passingTrials: 4, totalTrials: 5 },
      },
      regressionStatus: {
        scenarioName: 'test',
        gate: 'fail',
        stabilityLevel: 'medium',
        evaluators: [makeComparedEval({ statistical: tost })],
      },
    });

    const payload = buildContextPayload('run-006', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('n=5/5');
    expect(payload).toContain('0.1230');
    expect(payload).toContain('-0.0300');
    expect(payload).toContain('0.0800');
    expect(payload).toContain('non-inferior=false');
  });

  it('includes evaluator reasons from trial results', () => {
    const trial0 = makeTrial({
      trialIndex: 0,
      evalResults: [
        makeEvalResult({ evaluator: 'jtbd-completion', verdict: 'pass', reason: 'Task was completed' }),
      ],
    });
    const trial1 = makeTrial({
      trialIndex: 1,
      evalResults: [
        makeEvalResult({ evaluator: 'jtbd-completion', verdict: 'fail', reason: 'No output found' }),
      ],
    });
    const result = makeScenarioResult({
      aggregated: {
        'jtbd-completion': { passingTrials: 1, totalTrials: 2 },
      },
      trials: [trial0, trial1],
    });

    const payload = buildContextPayload('run-007', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Task was completed');
    expect(payload).toContain('No output found');
  });

  it('labels graduation mode in header', () => {
    const payload = buildContextPayload('run-008', [], {
      runMode: 'graduation',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Mode: graduation');
  });

  it('includes regression delta and exceeded flag', () => {
    const result = makeResultWithRegression();

    const payload = buildContextPayload('run-009', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('delta=-0.100');
    expect(payload).toContain('exceeded=false');
  });
});

// ── NarrativeSummaryReporter.render() tests ───────────────────────────────────

/**
 * Builds a scenario whose single trial fails an evaluator, so it is selected
 * for investigation and the strong-model narrative path runs.
 */
function makeInvestigableResult(baselineFilePath?: string): ScenarioResult {
  return makeScenarioResult({
    scenarioName: 'build-landing-page',
    aggregated: {
      'jtbd-completion': {
        passingTrials: 0,
        totalTrials: 1,
        passAt1: 0,
        passAtK: [{ k: 1, value: 0 }],
        passHatK: [{ k: 1, value: 0 }],
      },
    },
    trials: [
      makeTrial({
        trialIndex: 0,
        evalResults: [
          makeEvalResult({ evaluator: 'jtbd-completion', verdict: 'fail', reason: 'No output found' }),
        ],
      }),
    ],
    regressionStatus: {
      scenarioName: 'build-landing-page',
      gate: 'fail',
      stabilityLevel: 'medium',
      evaluators: [makeComparedEval({ exceeded: true })],
    },
    ...(baselineFilePath ? { baselineFilePath } : {}),
  });
}

describe('NarrativeSummaryReporter.render()', () => {
  const BASE_OPTIONS = {
    runMode: 'eval' as const,
    gitSha: null,
    gitBranch: null,
    generatedAt: '2026-06-25T00:00:00.000Z',
  };

  it('always leads with the deterministic verdict header, even with no investigable trials', async () => {
    const result = await reporter.render('run-pass', [makeResultWithRegression()], {
      ...BASE_OPTIONS,
    });
    expect(result).toMatch(/RESULT:\s*(PASS|WARNING|FAIL|N\/A)/);
    expect(result).toContain('## Provenance');
  });

  it('skips the LLM call when no trial needs investigation', async () => {
    const result = await reporter.render('run-clean', [makeResultWithRegression()], BASE_OPTIONS);
    expect(mockGocode.complete).not.toHaveBeenCalled();
    expect(result).toContain('narrative deep-dive is skipped');
  });

  it('appends the LLM narrative below the header when a trial needs investigation', async () => {
    mockGocode.complete.mockResolvedValue('## Scenario Overview\nInvestigated.');
    const result = await reporter.render('run-fail', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toMatch(/RESULT:\s*FAIL/);
    expect(mockGocode.complete).toHaveBeenCalledOnce();
    expect(result).toContain('Investigated.');
  });

  it('keeps the verdict header when gocode.complete() rejects', async () => {
    mockGocode.complete.mockRejectedValue(new Error('connection refused'));
    const result = await reporter.render('run-err', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toMatch(/RESULT:\s*FAIL/);
    expect(result).toContain('Narrative Deep-Dive Unavailable');
  });

  it('keeps the verdict header when gocode.complete() returns empty string', async () => {
    mockGocode.complete.mockResolvedValue('');
    const result = await reporter.render('run-empty', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toMatch(/RESULT:\s*FAIL/);
    expect(result).toContain('Narrative Deep-Dive Unavailable');
  });

  it('keeps the verdict header when gocode.complete() returns whitespace only', async () => {
    mockGocode.complete.mockResolvedValue('   \n  ');
    const result = await reporter.render('run-ws', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toContain('Narrative Deep-Dive Unavailable');
  });

  it('passes AbortSignal and temperature 0 to gocode.complete()', async () => {
    mockGocode.complete.mockResolvedValue('ok');
    await reporter.render('run-sig', [makeInvestigableResult()], BASE_OPTIONS);
    const callOptions = mockGocode.complete.mock.calls[0][1];
    expect(callOptions.signal).toBeInstanceOf(AbortSignal);
    expect(callOptions.temperature).toBe(0);
  });

  it('keeps the verdict header when the LLM call rejects with AbortError', async () => {
    const abortError = new DOMException('signal timed out', 'AbortError');
    mockGocode.complete.mockRejectedValue(abortError);
    const result = await reporter.render('run-abort', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toMatch(/RESULT:\s*FAIL/);
    expect(result).toContain('Narrative Deep-Dive Unavailable');
  });

  it('records provenance LLM fields (model, promptVersion, payloadSha) on the investigation path', async () => {
    mockGocode.complete.mockResolvedValue('narrative');
    vi.mocked(mockGocode as unknown as { getModel: ReturnType<typeof vi.fn> }).getModel = vi
      .fn()
      .mockReturnValue('base-model');
    const result = await reporter.render('run-prov', [makeInvestigableResult()], BASE_OPTIONS);
    expect(result).toContain('promptVersion:');
    expect(result).toContain('payloadSha:');
  });

  it('forbids verdict language in the system prompt', async () => {
    mockGocode.complete.mockResolvedValue('narrative');
    await reporter.render('run-prompt', [makeInvestigableResult()], BASE_OPTIONS);
    const systemPrompt: string = mockGocode.complete.mock.calls[0][0][0].content;
    expect(systemPrompt).toMatch(/do not.*contradict/i);
    expect(systemPrompt).toContain('## Regressing Behaviors');
    expect(systemPrompt).toContain('## Likely Correlated Code Changes');
  });

  it('no longer instructs the LLM to produce a Scenario Overview section', async () => {
    mockGocode.complete.mockResolvedValue('narrative');
    await reporter.render('run-no-overview', [makeInvestigableResult()], BASE_OPTIONS);
    const systemPrompt: string = mockGocode.complete.mock.calls[0][0][0].content;
    expect(systemPrompt).not.toContain('## Scenario Overview');
  });

  it('renders the deterministic Scenario Overview table in the header', async () => {
    mockGocode.complete.mockResolvedValue('narrative');
    const result: string = await reporter.render(
      'run-overview',
      [makeInvestigableResult()],
      BASE_OPTIONS,
    );
    expect(result).toContain('## Scenario Overview');
    expect(result).toContain('| Scenario | Verdict | Driving Evaluators | Key Pass Rates |');
  });

  it('includes per-commit git context in the prompt when baseline SHA and current SHA available', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );
    mockExecFileAsync.mockResolvedValue({
      stdout: 'abc1234\x1fadd landing page\x1f\x1e',
      stderr: '',
    });

    const result = makeInvestigableResult('/baselines/my-baseline.json');
    await reporter.render('run-git', [result], {
      ...BASE_OPTIONS,
      gitSha: 'current999',
      gitBranch: 'feat/my-feature',
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).toContain('Git Changes');
    expect(userMessage).toContain('add landing page');
  });

  it('omits git context when execFile throws for git commands', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );
    mockExecFileAsync.mockRejectedValue(new Error('git not found'));

    const result = makeInvestigableResult('/baselines/my-baseline.json');
    await reporter.render('run-nogit', [result], {
      ...BASE_OPTIONS,
      gitSha: 'current999',
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('omits git context when baseline file is unreadable', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    const result = makeInvestigableResult('/baselines/missing.json');
    await reporter.render('run-nobaseline', [result], {
      ...BASE_OPTIONS,
      gitSha: 'current999',
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('omits git context when currentSha is null even if baseline has SHA', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );

    const result = makeInvestigableResult('/baselines/present.json');
    await reporter.render('run-nocurrent', [result], {
      ...BASE_OPTIONS,
      gitSha: null,
    });

    expect(mockExecFileAsync).not.toHaveBeenCalled();
    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('uses the system prompt as the first message', async () => {
    mockGocode.complete.mockResolvedValue('narrative text');
    await reporter.render('run-sys', [makeInvestigableResult()], BASE_OPTIONS);

    const messages: Array<{ role: string; content: string }> = mockGocode.complete.mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content.length).toBeGreaterThan(50);
  });

  it('handles single scenario with a single passing trial (no investigation needed)', async () => {
    const result = makeScenarioResult({
      scenarioName: 'solo-scenario',
      trials: [
        makeTrial({
          trialIndex: 0,
          evalResults: [makeEvalResult({ verdict: 'pass', reason: 'done' })],
        }),
      ],
      aggregated: {
        'test-evaluator': { passingTrials: 1, totalTrials: 1, passAt1: 1, passAtK: [{ k: 1, value: 1 }], passHatK: [{ k: 1, value: 1 }] },
      },
    });

    const output = await reporter.render('run-solo', [result], BASE_OPTIONS);
    expect(mockGocode.complete).not.toHaveBeenCalled();
    expect(output).toMatch(/RESULT:\s*WARNING/);
    expect(output).toContain('narrative deep-dive is skipped');
  });


  it('does not throw when results have no trials and no aggregated data', async () => {
    const result = makeScenarioResult({ trials: [], aggregated: {} });
    await expect(reporter.render('run-bare', [result], BASE_OPTIONS)).resolves.toContain('RESULT:');
  });
});

// ── summaryAnalysisModel selection ────────────────────────────────────────────

describe('NarrativeSummaryReporter.render() — model selection', () => {
  const BASE_OPTIONS = {
    runMode: 'eval' as const,
    gitSha: null,
    gitBranch: null,
    generatedAt: '2026-06-25T00:00:00.000Z',
  };

  let baseComplete: ReturnType<typeof vi.fn>;
  let strongComplete: ReturnType<typeof vi.fn>;
  let strongClient: { complete: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
  let withModel: ReturnType<typeof vi.fn>;
  let baseClient: {
    complete: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
    withModel: ReturnType<typeof vi.fn>;
  };
  let modelReporter: NarrativeSummaryReporter;

  beforeEach(() => {
    vi.resetAllMocks();
    strongComplete = vi.fn().mockResolvedValue('# Strong narrative');
    strongClient = { complete: strongComplete, getModel: vi.fn().mockReturnValue('strong-model') };
    baseComplete = vi.fn().mockResolvedValue('# Base narrative');
    withModel = vi.fn().mockReturnValue(strongClient);
    baseClient = {
      complete: baseComplete,
      getModel: vi.fn().mockReturnValue('base-model'),
      withModel,
    };
    modelReporter = new NarrativeSummaryReporter(baseClient as unknown as IGocodeClient);
  });

  it('calls withModel and runs the narrative on the returned client when summaryAnalysisModel is set', async () => {
    const output = await modelReporter.render('run-strong', [makeInvestigableResult()], {
      ...BASE_OPTIONS,
      summaryAnalysisModel: 'strong-model',
    });

    expect(withModel).toHaveBeenCalledWith('strong-model');
    expect(strongComplete).toHaveBeenCalledOnce();
    expect(baseComplete).not.toHaveBeenCalled();
    expect(output).toContain('# Strong narrative');
  });

  it('uses the passed-in client and never calls withModel when summaryAnalysisModel is unset', async () => {
    const output = await modelReporter.render('run-base', [makeInvestigableResult()], BASE_OPTIONS);

    expect(withModel).not.toHaveBeenCalled();
    expect(baseComplete).toHaveBeenCalledOnce();
    expect(output).toContain('# Base narrative');
  });
});

// ── Numeric pass-estimator payload (seam: producer → narrative prompt) ────────

describe('buildContextPayload — numeric pass estimators', () => {
  it('emits numeric Pass@1, Pass@k, and Pass^k lines for a pass-rate evaluator', () => {
    const result = makeScenarioResult({
      scenarioName: 'numeric-estimators',
      aggregated: {
        'jtbd-completion': {
          passAt1: 0.6,
          passAtK: [
            { k: 1, value: 0.6 },
            { k: 2, value: 0.9 },
            { k: 3, value: 0.97 },
          ],
          passHatK: [
            { k: 1, value: 0.6 },
            { k: 2, value: 0.3 },
            { k: 3, value: 0.1 },
          ],
          passingTrials: 3,
          totalTrials: 5,
        },
      },
    });

    const payload = buildContextPayload('run-numeric', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Pass@1: 0.60');
    expect(payload).toContain('Pass@k: 1:0.60; 2:0.90; 3:0.97');
    expect(payload).toContain('Pass^k: 1:0.60; 2:0.30; 3:0.10');
  });

  it('emits Pass@1 for a score-mode evaluator when enrichment populated it', () => {
    const result = makeScenarioResult({
      scenarioName: 'latency-check',
      aggregated: {
        latency: {
          passAt1: 0.5,
          passingTrials: 1,
          totalTrials: 2,
          regressionMode: 'score',
          aggregateScore: 0.5,
        },
      },
    });

    const payload = buildContextPayload('run-score-mode', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Pass@1: 0.50');
  });

  it('renders N/A for undefined estimators without emitting "undefined"', () => {
    const result = makeScenarioResult({
      scenarioName: 'unenriched',
      aggregated: {
        latency: {
          passingTrials: 0,
          totalTrials: 1,
          regressionMode: 'score',
          aggregateScore: 0.75,
        },
      },
    });

    const payload = buildContextPayload('run-unenriched', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(payload).toContain('Pass@1: N/A');
    expect(payload).not.toContain('undefined');
  });
});
