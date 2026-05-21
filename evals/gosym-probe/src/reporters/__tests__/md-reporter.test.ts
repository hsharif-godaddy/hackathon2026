import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MdReporter,
  renderTrialEvalResultsMarkdown,
} from '../md-reporter.js';
import type { ScenarioResult } from '../../runner/types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { Turn } from '../../runner/transcript.js';
import { makeTurn, makeToolCall, makeTurnWithToolCalls } from './fixtures.js';

vi.mock('node:fs/promises');

import { writeFile, mkdir } from 'node:fs/promises';

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvalResult(
  evaluator: string,
  verdict:
    | 'pass'
    | 'partial'
    | 'fail'
    | 'unknown'
    | 'observed',
  score = 1.0,
  reason = 'test',
) {
  return { evaluator, score, verdict, reason };
}

function makeTrial(
  index: number,
  evalResults: (ReturnType<typeof makeEvalResult> | EvalResult)[],
  turns: Turn[] = [],
  errors: string[] = [],
) {
  return {
    trialIndex: index,
    transcript: {
      scenarioName: 'test',
      trialIndex: index,
      turns,
      snapshots: [],
      errors,
    },
    evalResults,
  };
}

const BASELINED_RESULT: ScenarioResult = {
  scenarioName: 'build-landing-page',
  stabilityLevel: 'medium',
  regressionStatus: {
    scenarioName: 'build-landing-page',
    gate: 'pass' as const,
    stabilityLevel: 'medium' as const,
    evaluators: [],
  },
  trials: [
    makeTrial(
      0,
      [
        makeEvalResult('bug-hit-rate', 'pass'),
        makeEvalResult('jtbd-completion', 'pass'),
      ],
      [
        makeTurn('user', 'Build page', 1000000),
        makeTurn('assistant', 'Done', 1045000),
      ],
    ),
    makeTrial(
      1,
      [
        makeEvalResult('bug-hit-rate', 'pass'),
        makeEvalResult(
          'jtbd-completion', 'unknown', 0,
          'Insufficient info',
        ),
      ],
      [
        makeTurn('user', 'Build page', 2000000),
        makeTurn('assistant', 'Done', 2050000),
      ],
    ),
    makeTrial(
      2,
      [
        makeEvalResult('bug-hit-rate', 'pass'),
        makeEvalResult('jtbd-completion', 'partial', 0.5),
      ],
      [
        makeTurn('user', 'Build page', 3000000),
        makeTurn('assistant', 'Done', 3040000),
      ],
    ),
  ],
  aggregated: {
    'bug-hit-rate': {
      passAtK: true,
      passToTheK: true,
      passingTrials: 3,
      totalTrials: 3,
    },
    'jtbd-completion': {
      passAtK: true,
      passToTheK: false,
      passingTrials: 1,
      totalTrials: 2,
    },
  },
};

const NO_BASELINE_RESULT: ScenarioResult = {
  scenarioName: 'new-feature',
  stabilityLevel: 'medium',
  trials: [
    makeTrial(0, [makeEvalResult('output-quality', 'pass')]),
  ],
  aggregated: {
    'output-quality': {
      passAtK: true,
      passToTheK: true,
      passingTrials: 1,
      totalTrials: 1,
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MdReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('creates results dir before writing', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    expect(mockMkdir).toHaveBeenCalledWith('results', { recursive: true });
    expect(mockMkdir).toHaveBeenCalledBefore(mockWriteFile);
  });

  it('writes to results/{runId}.md', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-abc', [BASELINED_RESULT]);

    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('results/run-abc.md');
  });

  it('returns the output file path', async () => {
    const reporter = new MdReporter();
    const path = await reporter.write('run-xyz', [BASELINED_RESULT]);
    expect(path).toBe('results/run-xyz.md');
  });

  it('includes runId in report header', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('run-001');
  });

  it('has a Gated Scenarios section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('Gated Scenarios');
  });

  it('has an Informational Scenarios section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT, NO_BASELINE_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('Informational Scenarios');
  });

  it('includes the suite summary tables', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT, NO_BASELINE_RESULT],
    );

    expect(content).toContain('## Suite Summary');
    expect(content).toContain('### Scenario pass rate (overall)');
    expect(content).toContain('### Evaluator rollup (across scenarios)');
    expect(content).toContain('| Evaluator | pass | partial | fail | unknown | pass rate |');
  });

  it('counts only pass@k evaluators in scenario pass fraction (excludes score-mode)', () => {
    const withObservational: ScenarioResult = {
      ...BASELINED_RESULT,
      trials: BASELINED_RESULT.trials.map((trial) => ({
        ...trial,
        evalResults: [
          ...trial.evalResults,
          makeEvalResult('token-usage', 'observed', 42),
        ],
      })),
      aggregated: {
        ...BASELINED_RESULT.aggregated,
        'token-usage': {
          passingTrials: 3,
          totalTrials: 3,
          regressionMode: 'score',
          medianScore: 42,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [withObservational]);
    const passRateSection = content.split(
      '### Scenario pass rate (overall)',
    )[1];
    expect(passRateSection).toBeDefined();
    expect(passRateSection).toContain('2/2 (100%)');
    expect(passRateSection).toContain('| pass | 2/2 (100%)');
    expect(passRateSection).not.toContain('2/3');
  });

  it('treats score-mode-only scenarios as overall pass (0/0 fraction)', () => {
    const scoreOnly: ScenarioResult = {
      scenarioName: 'latency-only',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('token-usage', 'observed', 100),
          makeEvalResult('llm-cost', 'observed', 0.01),
        ]),
      ],
      aggregated: {
        'llm-cost': {
          passingTrials: 1,
          totalTrials: 1,
          regressionMode: 'score',
          medianScore: 0.01,
        },
        'token-usage': {
          passingTrials: 1,
          totalTrials: 1,
          regressionMode: 'score',
          medianScore: 100,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scoreOnly]);
    expect(content).toContain('- Scenarios passed: **1** / 1');
    expect(content).toMatch(
      /\| latency-only \|[^\n]*\| pass \| 0\/0 \(0%\)/,
    );
  });

  it('renders trial links in a separate section at bottom (not inline in pass rate table)', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);

    // Links appear under the Trial Links heading
    const trialLinksSection = content.split('## Trial Links')[1];
    expect(trialLinksSection).toBeDefined();
    expect(trialLinksSection).toContain(
      '[T1](scenarios/build-landing-page/trials/0/eval-results.md)',
    );
    expect(trialLinksSection).toContain(
      '[T2](scenarios/build-landing-page/trials/1/eval-results.md)',
    );
    expect(trialLinksSection).toContain(
      '[T3](scenarios/build-landing-page/trials/2/eval-results.md)',
    );

    // Pass rate table should not have a Links column
    const passRateSection = content.split('### Scenario pass rate (overall)')[1]
      ?.split('###')[0];
    expect(passRateSection).not.toContain('| Links |');
  });

  it('includes an evaluator matrix', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);

    expect(content).toContain('| Scenario | Evaluator | pass@k | pass^k | Pass Rate | T1 | T2 | T3 |');
    expect(content).toContain(
      '| build-landing-page | jtbd-completion | ✓ | ✗ | 1/2 (50%) | pass | ⚠️ unknown | partial |',
    );
  });

  it('lists baselined scenario name in gated section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('build-landing-page');
  });

  it('lists non-baselined scenario name in informational section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT, NO_BASELINE_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('new-feature');
  });

  it('shows evaluator names in table', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('bug-hit-rate');
    expect(content as string).toContain('jtbd-completion');
  });

  it('shows pass@k and pass^k columns', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('pass@k');
    expect(content as string).toContain('pass^k');
  });

  it('renders pass@k and pass^k cells as "pass" or "fail" text', () => {
    const reporter = new MdReporter();
    // bug-hit-rate: passAtK=true, passToTheK=true
    // jtbd-completion: passAtK=true, passToTheK=false
    const content = reporter.render('run-001', [BASELINED_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) =>
      l.includes('| bug-hit-rate | pass | pass |'));
    const jtbdRow = lines.find((l) =>
      l.includes('| jtbd-completion | pass | fail |'));
    // per-trial cells use "pass (n.nn)" format, so bare "| pass |"
    // and "| fail |" tokens are unique to the passAtK / passToTheK columns
    expect(bugRow).toContain('| pass | pass |');
    expect(jtbdRow).toContain('| pass | fail |');
  });

  it('shows per-trial verdict columns (T1, T2, T3)', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('T1');
    expect(content as string).toContain('T2');
    expect(content as string).toContain('T3');
  });

  it('flags unknown verdicts in human review section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain(
      '## \u26a0\ufe0f Unknown Verdicts \u2014 Require Human Review',
    );
    expect(content as string).toContain('Insufficient info');
  });

  it('shows T2 label for unknown verdict from trialIndex 1', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    // trialIndex 1 → T2 (1-based)
    const lines = (content as string).split('\n');
    const unknownRow = lines.find(
      (l) => l.includes('jtbd-completion') && l.includes('T2'),
    );
    expect(unknownRow).toBeDefined();
  });

  it('sanitizes | in unknown verdict reason to prevent table corruption', async () => {
    const resultWithPipe: ScenarioResult = {
      scenarioName: 'pipe-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('my-eval', 'unknown', 0, 'col1 | col2'),
        ]),
      ],
      aggregated: {
        'my-eval': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [resultWithPipe]);

    const [, content] = mockWriteFile.mock.calls[0];
    const unknownsSection = (content as string).split(
      '## ⚠️ Unknown Verdicts',
    )[1];
    expect(unknownsSection).toBeDefined();
    const rows = unknownsSection!.split('\n').filter((l) => l.startsWith('|'));
    // Skip header and separator rows; find the data row
    const dataRow = rows.find((l) => l.includes('my-eval'));
    expect(dataRow).toBeDefined();
    // Each row must have exactly 4 data columns (5 pipes surrounding them)
    const cells = dataRow!.split('|').filter((c) => c.trim() !== '');
    expect(cells).toHaveLength(4);
  });

  it('sanitizes newlines in unknown verdict reason', async () => {
    const resultWithNewline: ScenarioResult = {
      scenarioName: 'nl-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('my-eval', 'unknown', 0, 'line1\nline2'),
        ]),
      ],
      aggregated: {
        'my-eval': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [resultWithNewline]);

    const content = mockWriteFile.mock.calls[0][1] as string;
    const unknownsSection = content.split(
      '## \u26a0\ufe0f Unknown Verdicts',
    )[1];
    expect(unknownsSection).toBeDefined();
    const dataRows = unknownsSection!
      .split('\n')
      .filter((l) => l.startsWith('|') && l.includes('my-eval'));
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]).toContain('line1 line2');
    const cells = dataRows[0].split('|').filter((c) => c.trim() !== '');
    expect(cells).toHaveLength(4);
  });

  it('uses fallback text when unknown verdict reason is empty', async () => {
    const resultEmpty: ScenarioResult = {
      scenarioName: 'empty-reason',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('my-eval', 'unknown', 0, '')]),
      ],
      aggregated: {
        'my-eval': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [resultEmpty]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('(no reason given)');
  });

  it('does not produce a <details> block when all trials pass', async () => {
    const allPass: ScenarioResult = {
      scenarioName: 'all-pass',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('bug-hit-rate', 'pass')]),
        makeTrial(1, [makeEvalResult('bug-hit-rate', 'pass')]),
      ],
      aggregated: {
        'bug-hit-rate': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 2,
          totalTrials: 2,
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [allPass]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).not.toContain('<details>');
  });

  it('omits unknown verdicts section when none present', async () => {
    const noUnknown: ScenarioResult = {
      scenarioName: 'clean',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('bug-hit-rate', 'pass')]),
      ],
      aggregated: {
        'bug-hit-rate': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [noUnknown]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).not.toContain('Unknown Verdicts');
  });

  it('notes informational section is informational', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [NO_BASELINE_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toMatch(/[Ii]nformational/);
  });

  it('notes gated section gates the PR', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toMatch(/gate|PR/i);
  });

  it('handles empty results array', async () => {
    const reporter = new MdReporter();
    const path = await reporter.write('run-empty', []);

    expect(path).toBe('results/run-empty.json'.replace('.json', '.md'));
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('run-empty');
  });

  it('render() is callable directly as a public method', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);
    expect(typeof content).toBe('string');
    expect(content).toContain('run-001');
  });

  it('respects custom resultsDir', async () => {
    const reporter = new MdReporter('/custom/dir');
    await reporter.write('run-001', [BASELINED_RESULT]);

    expect(mockMkdir).toHaveBeenCalledWith('/custom/dir', {
      recursive: true,
    });
    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('/custom/dir/run-001.md');
  });

  it(
    'renders observed verdict in trial table',
    async () => {
      const observed: ScenarioResult = {
        scenarioName: 'latency-check',
        stabilityLevel: 'medium',
        trials: [
          makeTrial(0, [
            makeEvalResult(
              'latency',
              'observed',
              0.75,
            ),
          ]),
        ],
        aggregated: {
          'latency': {
            passAtK: false,
            passToTheK: false,
            passingTrials: 0,
            totalTrials: 1,
            medianScore: 0.75,
            regressionMode: 'score',
          },
        },
      };
      const reporter = new MdReporter();
      await reporter.write('run-001', [observed]);

      const [, content] =
        mockWriteFile.mock.calls[0];
      expect(content as string).toContain(
        'observed',
      );
      expect(content as string).not.toContain(
        'undefined',
      );
    },
  );
});

// ── vs. baseline column ──────────────────────────────────────────────────────

function makeRegressionStatus(
  evaluator: string,
  delta: number,
  exceeded: boolean,
) {
  const currentScore = 0.8;
  return {
    scenarioName: 'build-landing-page',
    gate: exceeded ? ('error' as const) : ('pass' as const),
    stabilityLevel: 'medium' as const,
    evaluators: [
      {
        type: 'compared' as const,
        evaluator,
        currentScore,
        baselineScore: currentScore - delta,
        delta,
        exceeded,
      },
    ],
  };
}

const RESULT_WITH_BASELINE: import('../../runner/types.js').ScenarioResult = {
  ...BASELINED_RESULT,
  regressionStatus: makeRegressionStatus('bug-hit-rate', -0.1, false),
};

describe('MdReporter — vs. baseline column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('omits baseline column when regressionStatus is absent', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [NO_BASELINE_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).not.toContain('vs. baseline');
  });

  it('includes vs. baseline column when regressionStatus is present', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [RESULT_WITH_BASELINE]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('vs. baseline');
  });

  it('shows formatted negative delta', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [RESULT_WITH_BASELINE]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('-0.10');
  });

  it('shows formatted positive delta with + prefix', async () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatus('bug-hit-rate', 0.05, false),
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [result]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('+0.05');
  });

  it('prefixes ⚠️ for exceeded evaluator', async () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatus('bug-hit-rate', -0.33, true),
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [result]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('⚠️ -0.33');
  });

  it('shows — for NaN delta (no baseline data for evaluator)', async () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: {
        scenarioName: 'build-landing-page',
        gate: 'pass' as const,
        stabilityLevel: 'medium' as const,
        evaluators: [
          {
            type: 'compared' as const,
            evaluator: 'bug-hit-rate',
            currentScore: 1.0,
            baselineScore: NaN,
            delta: NaN,
            exceeded: false,
          },
        ],
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [result]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('vs. baseline');
    expect(content as string).toContain('—');
  });
});

// ── Enhanced summary tests ──────────────────────────────────

describe('MdReporter — run details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('includes run details table with scenario count', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT, NO_BASELINE_RESULT],
    );
    expect(content).toContain('Scenarios');
    expect(content).toContain('2');
    expect(content).not.toContain('| Run ID |');
  });

  it('includes total trial count in run details', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('Total Trials');
    expect(content).toContain('3');
  });

  it('includes duration in run details', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('Duration');
  });
});

describe('MdReporter — per-scenario sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('renders scenario name as ### heading', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('### build-landing-page');
  });

  it('shows timing summary per scenario', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('**Trials:** 3');
    expect(content).toMatch(/Avg Duration/);
    expect(content).toMatch(/Avg Turns/);
  });

  it('shows Mean and Range columns in scores table', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('Mean');
    expect(content).toContain('Range');
  });

  it('shows score in per-trial verdict cells', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    // bug-hit-rate T1 is pass with score 1.0
    expect(content).toContain('pass (1.00)');
  });

  it('includes evaluator reasoning in details block', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [BASELINED_RESULT],
    );
    expect(content).toContain('<details>');
    expect(content).toContain('Evaluator Reasoning');
    // reason from unknown verdict in fixture
    expect(content).toContain('Insufficient info');
  });

  it('shows "(no reason given)" placeholder for fail/partial with empty reason', () => {
    const emptyReasonResult: ScenarioResult = {
      scenarioName: 'empty-reasons',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('eval-a', 'fail', 0.0, ''),
          makeEvalResult('eval-b', 'partial', 0.5, ''),
        ]),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
        'eval-b': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [emptyReasonResult]);
    expect(content).toContain('<details>');
    expect(content).toContain('(no reason given)');
  });

  it('does not render NaN when an evaluator score is NaN', () => {
    const nanResult: ScenarioResult = {
      scenarioName: 'nan-score',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('my-eval', 'fail', NaN)]),
      ],
      aggregated: {
        'my-eval': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [nanResult]);
    expect(content).not.toContain('NaN');
  });

  it('does not include unknown verdict reason in <details> block', () => {
    // unknown verdicts have their own ## Unknown Verdicts section;
    // they must not also appear in the per-scenario <details> block
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);

    // BASELINED_RESULT has an unknown verdict with reason 'Insufficient info'
    // on jtbd-completion T2. It should appear only in the unknowns table,
    // not in the <details> reasoning block.
    const detailsSection = content.split('<details>')[1]?.split('</details>')[0];
    expect(detailsSection).not.toContain('Insufficient info');

    // But the unknowns table should still contain it
    expect(content).toContain('Insufficient info');
  });

  it('sanitizes newlines in fail reason in <details> block', () => {
    const resultWithNewline: ScenarioResult = {
      scenarioName: 'nl-details',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('eval-a', 'fail', 0.0, 'line1\nline2'),
        ]),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [resultWithNewline]);
    const detailsSection =
      content.split('<details>')[1]?.split('</details>')[0];
    expect(detailsSection).toBeDefined();
    expect(detailsSection).toContain('line1 line2');
    expect(detailsSection).not.toMatch(/line1\nline2/);
  });

  it('sanitizes | in fail/partial reason in <details> block', () => {
    const resultWithPipe: ScenarioResult = {
      scenarioName: 'pipe-details',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('eval-a', 'fail', 0.0, 'col1 | col2'),
        ]),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [resultWithPipe]);
    const detailsSection = content.split('<details>')[1]?.split('</details>')[0];
    expect(detailsSection).toBeDefined();
    expect(detailsSection).not.toContain('col1 | col2');
  });

  it('shows numeric mean and range for known scores', () => {
    const scoreResult: ScenarioResult = {
      scenarioName: 'score-check',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('eval-x', 'fail', 0.0)]),
        makeTrial(1, [makeEvalResult('eval-x', 'partial', 0.5)]),
        makeTrial(2, [makeEvalResult('eval-x', 'pass', 1.0)]),
      ],
      aggregated: {
        'eval-x': {
          passAtK: true,
          passToTheK: false,
          passingTrials: 1,
          totalTrials: 3,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scoreResult]);
    expect(content).toContain('0.50');
    expect(content).toContain('0.00-1.00');
  });
});

describe('MdReporter — failure/error counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('shows Tool Errors count when tool calls have errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'fails-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'fail')],
          [makeTurnWithToolCalls([makeToolCall(true), makeToolCall(false)])],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('**Tool Errors:** 1');
  });

  it('shows Runtime Errors count when transcript has runtime errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'errors-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'fail')],
          [],
          ['Socket disconnected', 'Timeout'],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('**Runtime Errors:** 2');
  });

  it('shows both Tool Errors and Runtime Errors when both are present', () => {
    const result: ScenarioResult = {
      scenarioName: 'both-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'fail')],
          [makeTurnWithToolCalls([makeToolCall(true)])],
          ['Socket disconnected'],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('**Tool Errors:** 1');
    expect(content).toContain('**Runtime Errors:** 1');
  });

  it('omits Tool Errors when all tool calls succeed', () => {
    const result: ScenarioResult = {
      scenarioName: 'clean-tools',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'pass')],
          [makeTurnWithToolCalls([makeToolCall(false)])],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('Tool Errors');
  });

  it('omits Runtime Errors when transcript has no runtime errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'clean-errors',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('eval-a', 'pass')]),
      ],
      aggregated: {
        'eval-a': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('**Runtime Errors:**');
  });

  it('aggregates Tool Errors and Runtime Errors across multiple trials', () => {
    const result: ScenarioResult = {
      scenarioName: 'multi-trial',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'fail')],
          [makeTurnWithToolCalls([makeToolCall(true)])],
          ['Error in trial 0'],
        ),
        makeTrial(
          1,
          [makeEvalResult('eval-a', 'fail')],
          [makeTurnWithToolCalls([makeToolCall(true), makeToolCall(true)])],
          ['Error A', 'Error B'],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: false,
          passToTheK: false,
          passingTrials: 0,
          totalTrials: 2,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('**Tool Errors:** 3');
    expect(content).toContain('**Runtime Errors:** 3');
  });
});

describe('MdReporter — score-mode pass@k rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('renders — in pass@k and pass^k columns when passAtK is absent', () => {
    const scoreModeResult: ScenarioResult = {
      scenarioName: 'latency-check',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'observed', 0.75)]),
      ],
      aggregated: {
        'latency': {
          passingTrials: 0,
          totalTrials: 1,
          medianScore: 0.75,
          regressionMode: 'score',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scoreModeResult]);
    const lines = content.split('\n');
    const latencyRow = lines.find((l) =>
      l.startsWith('| latency-check | latency |'));
    expect(latencyRow).toContain('| — | — |');
  });

  it('still renders pass/fail for pass-rate evaluator with defined passAtK', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) =>
      l.startsWith('| build-landing-page | bug-hit-rate |'));
    expect(bugRow).toContain('| pass | pass |');
  });

  it('renders — for passAtK: undefined even when regressionMode is absent', () => {
    const noModeResult: ScenarioResult = {
      scenarioName: 'no-mode',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('my-eval', 'observed', 0.5)]),
      ],
      aggregated: {
        'my-eval': {
          passingTrials: 0,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [noModeResult]);
    const lines = content.split('\n');
    const row = lines.find((l) =>
      l.startsWith('| no-mode | my-eval |'));
    expect(row).toContain('| — | — |');
  });
});

describe('MdReporter — formatDuration', () => {
  it('formats seconds-only duration', () => {
    // Single trial with 30s span
    const scenario: ScenarioResult = {
      scenarioName: 'quick',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'pass')],
          [
            makeTurn('user', 'Go', 1000000),
            makeTurn('assistant', 'Done', 1030000),
          ],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scenario]);
    expect(content).toContain('30s');
  });

  it('formats minutes + seconds duration', () => {
    const scenario: ScenarioResult = {
      scenarioName: 'medium',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'pass')],
          [
            makeTurn('user', 'Go', 1000000),
            makeTurn('assistant', 'Done', 1150000),
          ],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scenario]);
    // 150s = 2m 30s
    expect(content).toContain('2m 30s');
  });

  it('renders per-trial eval results markdown', () => {
    const content = renderTrialEvalResultsMarkdown(
      makeTrial(0, [
        makeEvalResult('eval-b', 'fail', 0.25, 'bad | reason'),
        makeEvalResult('eval-a', 'pass', 1, 'good'),
      ]),
    );

    expect(content).toContain('## Eval results');
    expect(content).toContain('- Scenario: `test`');
    expect(content).toContain('- Trial: `0`');
    expect(content).toContain('| Evaluator | Verdict | Score | Reason |');
    expect(content).toContain('| eval-a | pass | 1.00 | good |');
    expect(content).toContain('| eval-b | fail | 0.25 | bad   reason |');
  });
});

// ── Composite breakdown section ──────────────────────────────

function makeCompositeEvalResult(
  evaluatorName: string,
  breakdown: Array<{ evaluator: string; score: number; verdict: string; reason: string; scoreable: boolean }>,
  score = 0.8,
): ReturnType<typeof makeEvalResult> & { details: Record<string, unknown> } {
  return {
    evaluator: evaluatorName,
    score,
    verdict: 'pass',
    reason: `Composite of ${breakdown.length}/${breakdown.length} sub-evaluators`,
    details: {
      _composite: true,
      breakdown,
      scoredCount: breakdown.filter((e) => e.scoreable).length,
      totalCount: breakdown.length,
    },
  };
}

describe('MdReporter — composite breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('renders a breakdown <details> block for a composite evaluator', () => {
    const composite = makeCompositeEvalResult('output-quality', [
      { evaluator: 'heading-hierarchy', score: 0.9, verdict: 'pass', reason: 'ok', scoreable: true },
      { evaluator: 'visual-coherence', score: 0.7, verdict: 'pass', reason: 'ok', scoreable: true },
    ]);

    const result: ScenarioResult = {
      scenarioName: 'composite-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [composite])],
      aggregated: {
        'output-quality': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).toContain('output-quality breakdown');
    expect(content).toContain('heading-hierarchy');
    expect(content).toContain('visual-coherence');
  });

  it('does not render a breakdown block for non-composite evaluator results', () => {
    const result: ScenarioResult = {
      scenarioName: 'plain-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [makeEvalResult('bug-hit-rate', 'pass', 1.0)])],
      aggregated: {
        'bug-hit-rate': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).not.toContain('breakdown');
  });

  it('shows per-trial sub-evaluator scores in the breakdown table', () => {
    const breakdownT1 = [
      { evaluator: 'heading-hierarchy', score: 0.9, verdict: 'pass', reason: 'ok', scoreable: true },
      { evaluator: 'visual-coherence', score: 0.5, verdict: 'partial', reason: 'ok', scoreable: true },
    ];
    const breakdownT2 = [
      { evaluator: 'heading-hierarchy', score: 0.6, verdict: 'partial', reason: 'ok', scoreable: true },
      { evaluator: 'visual-coherence', score: 0.8, verdict: 'pass', reason: 'ok', scoreable: true },
    ];

    const result: ScenarioResult = {
      scenarioName: 'multi-trial-composite',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeCompositeEvalResult('output-quality', breakdownT1, 0.7)]),
        makeTrial(1, [makeCompositeEvalResult('output-quality', breakdownT2, 0.7)]),
      ],
      aggregated: {
        'output-quality': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 2,
          totalTrials: 2,
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    // Sub-evaluator rows present
    expect(content).toContain('heading-hierarchy');
    expect(content).toContain('visual-coherence');
    // Per-trial scores present
    expect(content).toContain('0.90');
    expect(content).toContain('0.50');
    expect(content).toContain('0.60');
    expect(content).toContain('0.80');
  });
});

// ── Score-mode pass fraction ──────────────────────────────────

describe('MdReporter — score-mode pass fraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('includes enriched score-mode evaluator (passAtK defined) in scenario pass fraction denominator', () => {
    // 1 pass-rate evaluator (passAtK: true) + 1 enriched score-mode (passAtK: true)
    // Both have meaningful pass/fail semantics → denominator should be 2
    const result: ScenarioResult = {
      scenarioName: 'mixed-enriched',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('jtbd-completion', 'pass'),
          makeEvalResult('latency', 'observed', 0.5),
        ]),
      ],
      aggregated: {
        'jtbd-completion': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
        'latency': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
          medianScore: 0.5,
          regressionMode: 'score',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    // Both evaluators in denominator → 2/2 (100%)
    expect(content).toContain('2/2');
    expect(content).toContain('100%');
  });

  it('excludes unenriched score-mode evaluator (passAtK absent) from scenario pass fraction denominator', () => {
    // 1 pass-rate evaluator (passAtK: true) + 1 unenriched score-mode (passAtK: undefined)
    // Only the pass-rate evaluator has pass/fail semantics → denominator should be 1
    const result: ScenarioResult = {
      scenarioName: 'mixed-unenriched',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('jtbd-completion', 'pass'),
          makeEvalResult('latency', 'observed', 0.5),
        ]),
      ],
      aggregated: {
        'jtbd-completion': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 1,
          totalTrials: 1,
        },
        'latency': {
          // no passAtK — unenriched (no baseline)
          passingTrials: 0,
          totalTrials: 1,
          medianScore: 0.5,
          regressionMode: 'score',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    // Only jtbd-completion in denominator → 1/1 (100%), not 1/2 (50%)
    expect(content).toContain('1/1');
    expect(content).toContain('100%');
  });
});

// ── Mode line rendering ──────────────────────────────────────────────────────

describe('MdReporter — mode line', () => {
  it('renders graduation mode with stability counts', () => {
    const results: ScenarioResult[] = [
      { ...BASELINED_RESULT, stabilityLevel: 'medium' },
      { ...NO_BASELINE_RESULT, stabilityLevel: 'medium' },
    ];
    const reporter = new MdReporter();
    const content = reporter.render('run-001', results, { runMode: 'graduation' });

    expect(content).toContain('Mode:');
    expect(content).toContain('graduation');
    expect(content).toContain('medium (5 trials)');
  });

  it('renders skipBaseline mode', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], { skipBaseline: true });

    expect(content).toContain('Baseline:');
    expect(content).toContain('skipped');
  });

  it('renders no baseline when no results have baselineFilePath', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);

    expect(content).toContain('Baseline:');
    expect(content).toContain('none');
  });

  it('renders baseline file paths when results have baselineFilePath', () => {
    const resultWithBaseline: ScenarioResult = {
      ...BASELINED_RESULT,
      baselineFilePath: 'baselines/build-landing-page/2026-01-01T00-00-00.json',
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [resultWithBaseline, NO_BASELINE_RESULT]);

    expect(content).toContain('baselines/build-landing-page/2026-01-01T00-00-00.json');
    expect(content).toContain('compared');
  });
});

// ── Score-mode evaluators with baseline comparison ───────────────────────────

/**
 * Fixture: score-mode evaluator after ScoreModeEnricher has been applied.
 * T0 passed the baseline comparison (verdict: 'pass'), T1 exceeded the
 * regression threshold (verdict: 'fail'). aggregated.latency has passAtK
 * defined because enrichment ran.
 */
const SCORE_MODE_ENRICHED_RESULT: ScenarioResult = {
  scenarioName: 'latency-check',
  stabilityLevel: 'medium',
  regressionStatus: {
    scenarioName: 'latency-check',
    gate: 'error' as const,
    stabilityLevel: 'medium' as const,
    evaluators: [],
  },
  trials: [
    makeTrial(0, [{ ...makeEvalResult('latency', 'pass', 0.5, 'Total AAB duration: 500ms across 3 turns'), baselineComparison: 'latency: 0.5 vs baseline 1 (threshold 25%) → pass' }]),
    makeTrial(1, [{ ...makeEvalResult('latency', 'fail', 0.9, 'Total AAB duration: 900ms across 3 turns'), baselineComparison: 'latency: 0.9 vs baseline 1 (threshold 25%) → fail' }]),
  ],
  aggregated: {
    latency: {
      passAtK: true,
      passToTheK: false,
      passingTrials: 1,
      totalTrials: 2,
      regressionMode: 'score',
      medianScore: 0.5,
    },
  },
};

describe('MdReporter — score-mode evaluators with baseline comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('per-trial cell shows pass for enriched pass trial', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [SCORE_MODE_ENRICHED_RESULT]);
    expect(content).toContain('pass (0.50)');
  });

  it('per-trial cell shows fail for enriched fail trial', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [SCORE_MODE_ENRICHED_RESULT]);
    expect(content).toContain('fail (0.90)');
  });

  it('rollup table includes score-mode evaluator row with correct pass and fail counts', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [SCORE_MODE_ENRICHED_RESULT]);
    const rollupSection = content.split('### Evaluator rollup (across scenarios)')[1];
    expect(rollupSection).toBeDefined();
    // latency: 1 pass, 0 partial, 1 fail, 0 unknown → 50% pass rate
    expect(rollupSection).toContain('| latency | 1 | 0 | 1 | 0 | 50% |');
  });

  it('reasoning block includes evaluator name, diagnostic reason, and baseline comparison for fail trial', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [SCORE_MODE_ENRICHED_RESULT]);
    const detailsSection = content.split('<details>')[1]?.split('</details>')[0];
    expect(detailsSection).toBeDefined();
    expect(detailsSection).toContain('latency');
    expect(detailsSection).toContain('Total AAB duration: 900ms across 3 turns');
    expect(detailsSection).toContain('latency: 0.9 vs baseline 1 (threshold 25%) → fail');
  });

  it('unenriched (skip-baseline) trials keep observed in per-trial cells and are excluded from rollup', () => {
    const unenriched: ScenarioResult = {
      scenarioName: 'latency-unenriched',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'observed', 0.5)]),
      ],
      aggregated: {
        latency: {
          passingTrials: 0,
          totalTrials: 1,
          regressionMode: 'score',
          medianScore: 0.5,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [unenriched]);
    expect(content).toContain('observed (0.50)');
    // Isolate just the rollup table: it ends before the run-details table
    // (renderRunDetails starts with '| Field | Value |')
    const afterRollupHeading = content.split('### Evaluator rollup (across scenarios)')[1];
    expect(afterRollupHeading).toBeDefined();
    const rollupTableOnly = afterRollupHeading!.split('| Field | Value |')[0];
    expect(rollupTableOnly).not.toContain('| latency |');
  });
});

// ── RenderOptions integration ───────────────────────────────────────────────

describe('MdReporter — RenderOptions integration', () => {
  it('includes wall clock duration when wallClockMs is provided', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], { wallClockMs: 125000 });

    expect(content).toContain('Wall Clock');
    expect(content).toContain('2m 5s');
  });

  it('omits wall clock line when wallClockMs is not provided', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);

    expect(content).not.toContain('Wall Clock');
  });

  it('renders runMode in mode line via options', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], { runMode: 'eval' });

    expect(content).toContain('Mode:');
    expect(content).toContain('eval');
  });
});
