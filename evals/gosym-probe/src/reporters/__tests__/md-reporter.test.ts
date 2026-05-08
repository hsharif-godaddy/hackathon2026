import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MdReporter } from '../md-reporter.js';
import type { ScenarioResult } from '../../runner/types.js';
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
  evalResults: ReturnType<typeof makeEvalResult>[],
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

const REGRESSION_RESULT: ScenarioResult = {
  scenarioName: 'build-landing-page',
  category: 'regression',
  stabilityLevel: 'medium',
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

const CAPABILITY_RESULT: ScenarioResult = {
  scenarioName: 'new-feature',
  category: 'capability',
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
    await reporter.write('run-001', [REGRESSION_RESULT]);

    expect(mockMkdir).toHaveBeenCalledWith('results', { recursive: true });
    expect(mockMkdir).toHaveBeenCalledBefore(mockWriteFile);
  });

  it('writes to results/{runId}.md', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-abc', [REGRESSION_RESULT]);

    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toBe('results/run-abc.md');
  });

  it('returns the output file path', async () => {
    const reporter = new MdReporter();
    const path = await reporter.write('run-xyz', [REGRESSION_RESULT]);
    expect(path).toBe('results/run-xyz.md');
  });

  it('includes runId in report header', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('run-001');
  });

  it('has a Regression Scenarios section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('Regression Scenarios');
  });

  it('has a Capability Scenarios section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT, CAPABILITY_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('Capability Scenarios');
  });

  it('lists regression scenario name in regression section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('build-landing-page');
  });

  it('lists capability scenario name in capability section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT, CAPABILITY_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('new-feature');
  });

  it('shows evaluator names in table', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('bug-hit-rate');
    expect(content as string).toContain('jtbd-completion');
  });

  it('shows pass@k and pass^k columns', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('pass@k');
    expect(content as string).toContain('pass^k');
  });

  it('renders pass@k and pass^k cells as "pass" or "fail" text', () => {
    const reporter = new MdReporter();
    // bug-hit-rate: passAtK=true, passToTheK=true
    // jtbd-completion: passAtK=true, passToTheK=false
    const content = reporter.render('run-001', [REGRESSION_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) => l.includes('bug-hit-rate'));
    const jtbdRow = lines.find((l) => l.includes('jtbd-completion'));
    // per-trial cells use "pass (n.nn)" format, so bare "| pass |"
    // and "| fail |" tokens are unique to the passAtK / passToTheK columns
    expect(bugRow).toContain('| pass | pass |');
    expect(jtbdRow).toContain('| pass | fail |');
  });

  it('shows per-trial verdict columns (T1, T2, T3)', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('T1');
    expect(content as string).toContain('T2');
    expect(content as string).toContain('T3');
  });

  it('flags unknown verdicts in human review section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain(
      '## \u26a0\ufe0f Unknown Verdicts \u2014 Require Human Review',
    );
    expect(content as string).toContain('Insufficient info');
  });

  it('shows T2 label for unknown verdict from trialIndex 1', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

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
      category: 'regression',
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
      category: 'regression',
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
      category: 'regression',
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
      category: 'regression',
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
      category: 'regression',
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

  it('notes capability section is informational', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [CAPABILITY_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toMatch(/[Ii]nformational/);
  });

  it('notes regression section gates the PR', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [REGRESSION_RESULT]);

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
    const content = reporter.render('run-001', [REGRESSION_RESULT]);
    expect(typeof content).toBe('string');
    expect(content).toContain('run-001');
  });

  it('respects custom resultsDir', async () => {
    const reporter = new MdReporter('/custom/dir');
    await reporter.write('run-001', [REGRESSION_RESULT]);

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
        category: 'capability',
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
    category: 'regression' as const,
    hasBaseline: true,
    gate: exceeded ? ('error' as const) : ('pass' as const),
    stabilityLevel: 'medium' as const,
    evaluators: [
      {
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
  ...REGRESSION_RESULT,
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
    await reporter.write('run-001', [REGRESSION_RESULT]);

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
      ...REGRESSION_RESULT,
      regressionStatus: makeRegressionStatus('bug-hit-rate', 0.05, false),
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [result]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('+0.05');
  });

  it('prefixes ⚠️ for exceeded evaluator', async () => {
    const result = {
      ...REGRESSION_RESULT,
      regressionStatus: makeRegressionStatus('bug-hit-rate', -0.33, true),
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [result]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('⚠️ -0.33');
  });

  it('shows — for NaN delta (no baseline data for evaluator)', async () => {
    const result = {
      ...REGRESSION_RESULT,
      regressionStatus: {
        scenarioName: 'build-landing-page',
        category: 'regression' as const,
        hasBaseline: false,
        gate: 'pass' as const,
        stabilityLevel: 'medium' as const,
        evaluators: [
          {
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
      [REGRESSION_RESULT, CAPABILITY_RESULT],
    );
    expect(content).toContain('Scenarios');
    expect(content).toContain('2');
    expect(content).not.toContain('| Run ID |');
  });

  it('includes total trial count in run details', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
    );
    expect(content).toContain('Total Trials');
    expect(content).toContain('3');
  });

  it('includes duration in run details', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
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
      [REGRESSION_RESULT],
    );
    expect(content).toContain('### build-landing-page');
  });

  it('shows timing summary per scenario', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
    );
    expect(content).toContain('**Trials:** 3');
    expect(content).toMatch(/Avg Duration/);
    expect(content).toMatch(/Avg Turns/);
  });

  it('shows Mean and Range columns in scores table', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
    );
    expect(content).toContain('Mean');
    expect(content).toContain('Range');
  });

  it('shows score in per-trial verdict cells', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
    );
    // bug-hit-rate T1 is pass with score 1.0
    expect(content).toContain('pass (1.00)');
  });

  it('includes evaluator reasoning in details block', () => {
    const reporter = new MdReporter();
    const content = reporter.render(
      'run-001',
      [REGRESSION_RESULT],
    );
    expect(content).toContain('<details>');
    expect(content).toContain('Evaluator Reasoning');
    // reason from unknown verdict in fixture
    expect(content).toContain('Insufficient info');
  });

  it('shows "(no reason given)" placeholder for fail/partial with empty reason', () => {
    const emptyReasonResult: ScenarioResult = {
      scenarioName: 'empty-reasons',
      category: 'capability',
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
      category: 'capability',
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
    const content = reporter.render('run-001', [REGRESSION_RESULT]);

    // REGRESSION_RESULT has an unknown verdict with reason 'Insufficient info'
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
      category: 'capability',
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
      category: 'capability',
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
      category: 'capability',
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

  it('shows Tool Failures count when tool calls have errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'fails-scenario',
      category: 'capability',
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
    expect(content).toContain('**Tool Failures:** 1');
  });

  it('shows Errors count when transcript has runtime errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'errors-scenario',
      category: 'capability',
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
    expect(content).toContain('**Errors:** 2');
  });

  it('shows both Tool Failures and Errors when both are present', () => {
    const result: ScenarioResult = {
      scenarioName: 'both-scenario',
      category: 'capability',
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
    expect(content).toContain('**Tool Failures:** 1');
    expect(content).toContain('**Errors:** 1');
  });

  it('omits Tool Failures when all tool calls succeed', () => {
    const result: ScenarioResult = {
      scenarioName: 'clean-tools',
      category: 'capability',
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
    expect(content).not.toContain('Tool Failures');
  });

  it('omits Errors when transcript has no runtime errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'clean-errors',
      category: 'capability',
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
    expect(content).not.toContain('**Errors:**');
  });

  it('aggregates Tool Failures and Errors across multiple trials', () => {
    const result: ScenarioResult = {
      scenarioName: 'multi-trial',
      category: 'capability',
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
    expect(content).toContain('**Tool Failures:** 3');
    expect(content).toContain('**Errors:** 3');
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
      category: 'capability',
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
    const latencyRow = lines.find((l) => l.includes('latency') && l.startsWith('|'));
    expect(latencyRow).toContain('| — | — |');
  });

  it('still renders pass/fail for pass-rate evaluator with defined passAtK', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [REGRESSION_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) => l.includes('bug-hit-rate'));
    expect(bugRow).toContain('| pass | pass |');
  });

  it('renders — for passAtK: undefined even when regressionMode is absent', () => {
    const noModeResult: ScenarioResult = {
      scenarioName: 'no-mode',
      category: 'capability',
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
    const row = lines.find((l) => l.includes('my-eval') && l.startsWith('|'));
    expect(row).toContain('| — | — |');
  });
});

describe('MdReporter — formatDuration', () => {
  it('formats seconds-only duration', () => {
    // Single trial with 30s span
    const scenario: ScenarioResult = {
      scenarioName: 'quick',
      category: 'regression',
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
      category: 'regression',
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
});
