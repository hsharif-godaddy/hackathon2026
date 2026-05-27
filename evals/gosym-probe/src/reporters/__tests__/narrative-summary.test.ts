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
        passAtK: true,
        passToTheK: false,
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

let mockGocode: { complete: ReturnType<typeof vi.fn> };
let reporter: NarrativeSummaryReporter;

beforeEach(() => {
  vi.resetAllMocks();
  mockGocode = { complete: vi.fn().mockResolvedValue('# Narrative\nAll good.') };
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

describe('NarrativeSummaryReporter.render()', () => {
  const BASE_OPTIONS = {
    runMode: 'eval' as const,
    gitSha: null,
    gitBranch: null,
  };

  it('returns LLM output on success', async () => {
    mockGocode.complete.mockResolvedValue('# Narrative\nThings look good.');
    const result = await reporter.render('run-ok', [], BASE_OPTIONS);
    expect(result).toBe('# Narrative\nThings look good.');
  });

  it('returns fallback stub when gocode.complete() rejects', async () => {
    mockGocode.complete.mockRejectedValue(new Error('connection refused'));
    const result = await reporter.render('run-err', [], BASE_OPTIONS);
    expect(result).toContain('Narrative Summary Unavailable');
    expect(result).toContain('aggregate-report.md');
  });

  it('returns fallback stub when gocode.complete() returns empty string', async () => {
    mockGocode.complete.mockResolvedValue('');
    const result = await reporter.render('run-empty', [], BASE_OPTIONS);
    expect(result).toContain('Narrative Summary Unavailable');
    expect(result).toContain('aggregate-report.md');
  });

  it('returns fallback stub when gocode.complete() returns whitespace only', async () => {
    mockGocode.complete.mockResolvedValue('   \n  ');
    const result = await reporter.render('run-ws', [], BASE_OPTIONS);
    expect(result).toContain('Narrative Summary Unavailable');
  });

  it('passes AbortSignal to gocode.complete()', async () => {
    mockGocode.complete.mockResolvedValue('ok');
    await reporter.render('run-sig', [], BASE_OPTIONS);
    const callOptions = mockGocode.complete.mock.calls[0][1];
    expect(callOptions).toHaveProperty('signal');
    expect(callOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns fallback stub when LLM call rejects with AbortError', async () => {
    const abortError = new DOMException('signal timed out', 'AbortError');
    mockGocode.complete.mockRejectedValue(abortError);
    const result = await reporter.render('run-abort', [], BASE_OPTIONS);
    expect(result).toContain('Narrative Summary Unavailable');
    expect(result).toContain('aggregate-report.md');
  });

  it('includes git context in prompt when baseline SHA and current SHA available', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'abc1234 add landing page\ndef5678 fix tests\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: ' 3 files changed, 42 insertions\n', stderr: '' });

    const result = makeResultWithRegression('/baselines/my-baseline.json');
    await reporter.render('run-git', [result], {
      runMode: 'eval',
      gitSha: 'current999',
      gitBranch: 'feat/my-feature',
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).toContain('Git Changes');
    expect(userMessage).toContain('add landing page');
    expect(userMessage).toContain('3 files changed');
  });

  it('omits git context when execFile throws for both git commands', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );
    mockExecFileAsync.mockRejectedValue(new Error('git not found'));

    const result = makeResultWithRegression('/baselines/my-baseline.json');
    await reporter.render('run-nogit', [result], {
      runMode: 'eval',
      gitSha: 'current999',
      gitBranch: null,
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('omits git context when baseline file is unreadable', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    const result = makeResultWithRegression('/baselines/missing.json');
    await reporter.render('run-nobaseline', [result], {
      runMode: 'eval',
      gitSha: 'current999',
      gitBranch: null,
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('omits git context when currentSha is null even if baseline has SHA', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );

    const result = makeResultWithRegression('/baselines/present.json');
    await reporter.render('run-nocurrent', [result], {
      runMode: 'eval',
      gitSha: null,
      gitBranch: null,
    });

    expect(mockExecFileAsync).not.toHaveBeenCalled();
    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).not.toContain('Git Changes');
  });

  it('caps combined git output at 4000 chars with truncation notice', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ gitSha: 'base123', runId: 'r1', createdAt: '2026-01-01', scenarioName: 'test', scores: {} }),
    );
    const longOutput = 'a'.repeat(5000);
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: longOutput, stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = makeResultWithRegression('/baselines/present.json');
    await reporter.render('run-cap', [result], {
      runMode: 'eval',
      gitSha: 'current999',
      gitBranch: null,
    });

    const userMessage: string = mockGocode.complete.mock.calls[0][0][1].content;
    expect(userMessage).toContain('[truncated]');
    // verify the git section doesn't balloon well beyond 4000 chars
    const gitSection = userMessage.split('Git Changes')[1] ?? '';
    expect(gitSection.length).toBeLessThan(4200);
  });

  it('uses the system prompt as the first message', async () => {
    mockGocode.complete.mockResolvedValue('narrative text');
    await reporter.render('run-sys', [], BASE_OPTIONS);

    const messages: Array<{ role: string; content: string }> = mockGocode.complete.mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content.length).toBeGreaterThan(50);
  });

  it('handles single scenario with a single trial', async () => {
    const result = makeScenarioResult({
      scenarioName: 'solo-scenario',
      trials: [
        makeTrial({
          trialIndex: 0,
          evalResults: [makeEvalResult({ verdict: 'pass', reason: 'done' })],
        }),
      ],
      aggregated: {
        'test-evaluator': { passingTrials: 1, totalTrials: 1, passAtK: true, passToTheK: true },
      },
    });

    mockGocode.complete.mockResolvedValue('solo narrative');
    const output = await reporter.render('run-solo', [result], BASE_OPTIONS);
    expect(output).toBe('solo narrative');
  });

  it('does not throw when results have no trials and no aggregated data', async () => {
    const result = makeScenarioResult({ trials: [], aggregated: {} });
    mockGocode.complete.mockResolvedValue('empty narrative');
    await expect(reporter.render('run-bare', [result], BASE_OPTIONS)).resolves.toBe('empty narrative');
  });
});
