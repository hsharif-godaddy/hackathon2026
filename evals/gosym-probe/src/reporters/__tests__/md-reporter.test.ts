import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MdReporter,
  renderTrialEvalResultsMarkdown,
} from '../md-reporter.js';
import type { ScenarioResult } from '../../runner/types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { Turn } from '../../runner/transcript.js';
import type {
  StatisticalMetadata,
  RegressionEvalResult,
} from '../../baselines/types.js';
import type { WilsonCI } from '../../util/pass-at-k.js';
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
    | 'fail'
    | 'incomplete'
    | 'directional',
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
  captureErrors: string[] = [],
) {
  return {
    trialIndex: index,
    transcript: {
      scenarioName: 'test',
      trialIndex: index,
      turns,
      snapshots: [],
      errors,
      captureErrors,
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
          'jtbd-completion', 'incomplete', 0,
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
        makeEvalResult('jtbd-completion', 'fail', 0.5),
      ],
      [
        makeTurn('user', 'Build page', 3000000),
        makeTurn('assistant', 'Done', 3040000),
      ],
    ),
  ],
  aggregated: {
    'bug-hit-rate': {
      passAt1: 1.0,
      passAtK: [{ k: 1, value: 1.0 }, { k: 2, value: 1.0 }],
      passHatK: [{ k: 1, value: 1.0 }, { k: 2, value: 1.0 }],
      passingTrials: 3,
      totalTrials: 3,
      comparisonMode: 'passRate',
    },
    'jtbd-completion': {
      passAt1: 0.5,
      passAtK: [{ k: 1, value: 0.5 }],
      passHatK: [{ k: 1, value: 0.5 }],
      passingTrials: 1,
      totalTrials: 2,
      comparisonMode: 'passRate',
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
      passAt1: 1.0,
      passAtK: [{ k: 1, value: 1.0 }],
      passHatK: [{ k: 1, value: 1.0 }],
      passingTrials: 1,
      totalTrials: 1,
      comparisonMode: 'passRate',
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
    expect(content).toContain('### Evaluator rollup (across scenarios)');
    expect(content).toContain('| Evaluator | pass | fail | incomplete | pass rate |');
  });

  it('renders trial links in a separate section at bottom', () => {
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
  });

  it('includes an evaluator matrix', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);

    expect(content).toContain('| Scenario | Evaluator | pass@1 | pass@k | pass^k | Pass Rate | T1 | T2 | T3 |');
    expect(content).toContain(
      '| build-landing-page | jtbd-completion | 0.50 (n=2) | 1:0.50 | 1:0.50 | 1/2 (50%) | pass | ⚠️ incomplete | fail |',
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

  it('renders pass@k and pass^k cells as numeric estimator vectors', () => {
    const reporter = new MdReporter();
    // bug-hit-rate: passAtK={1:1.0, 2:1.0}, passHatK={1:1.0, 2:1.0}
    // jtbd-completion: passAtK={1:0.5}, passHatK={1:0.5}
    const content = reporter.render('run-001', [BASELINED_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) =>
      l.includes('bug-hit-rate') && l.includes('1:1.00; 2:1.00'));
    const jtbdRow = lines.find((l) =>
      l.includes('jtbd-completion') && l.includes('1:0.50'));
    expect(bugRow).toContain('| 1:1.00; 2:1.00 | 1:1.00; 2:1.00 |');
    expect(jtbdRow).toContain('| 1:0.50 | 1:0.50 |');
  });

  it('shows per-trial verdict columns (T1, T2, T3)', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain('T1');
    expect(content as string).toContain('T2');
    expect(content as string).toContain('T3');
  });

  it('flags incomplete verdicts in human review section', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain(
      '## \u26a0\ufe0f Incomplete Verdicts \u2014 Require Human Review',
    );
    expect(content as string).toContain('Insufficient info');
  });

  it('renders a Signal Disagreements section when static and judge diverge', () => {
    const disagreeResult: ScenarioResult = {
      scenarioName: 'build-landing-page',
      stabilityLevel: 'low',
      trials: [
        makeTrial(0, [
          makeEvalResult('expected-artifact-match', 'fail', 0, 'no contact'),
          makeEvalResult('narrow-artifact-judge', 'pass', 1, 'looks fine'),
        ]),
      ],
      aggregated: {},
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [disagreeResult]);
    expect(content).toContain('Signal Disagreements');
    expect(content).toContain('valid-but-different');
    const row = content
      .split('\n')
      .find((l) => l.includes('build-landing-page') && l.includes('T1') && l.includes('fail'));
    expect(row).toBeDefined();
  });

  it('omits the Signal Disagreements section when verdicts agree', () => {
    const agreeResult: ScenarioResult = {
      scenarioName: 'build-landing-page',
      stabilityLevel: 'low',
      trials: [
        makeTrial(0, [
          makeEvalResult('expected-artifact-match', 'pass', 1, 'ok'),
          makeEvalResult('narrow-artifact-judge', 'pass', 1, 'ok'),
        ]),
      ],
      aggregated: {},
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [agreeResult]);
    expect(content).not.toContain('Signal Disagreements');
  });

  it('renders a Grader Stability section for multi-trial runs', () => {
    const multiTrial: ScenarioResult = {
      scenarioName: 'build-landing-page',
      stabilityLevel: 'low',
      trials: [
        makeTrial(0, [makeEvalResult('expected-artifact-match', 'pass', 1, 'ok')]),
        makeTrial(1, [makeEvalResult('expected-artifact-match', 'fail', 0.5, 'meh')]),
      ],
      aggregated: {},
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [multiTrial]);
    expect(content).toContain('Grader Stability');
    expect(content).toContain('Flip-rate');
    const row = content
      .split('\n')
      .find((l) => l.includes('expected-artifact-match') && l.includes('1.00'));
    expect(row).toBeDefined();
  });

  it('omits the Grader Stability section for single-trial runs', () => {
    const single: ScenarioResult = {
      scenarioName: 'build-landing-page',
      stabilityLevel: 'low',
      trials: [makeTrial(0, [makeEvalResult('expected-artifact-match', 'pass', 1, 'ok')])],
      aggregated: {},
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [single]);
    expect(content).not.toContain('Grader Stability');
  });

  it('shows T2 label for incomplete verdict from trialIndex 1', async () => {
    const reporter = new MdReporter();
    await reporter.write('run-001', [BASELINED_RESULT]);

    const [, content] = mockWriteFile.mock.calls[0];
    // trialIndex 1 → T2 (1-based)
    const lines = (content as string).split('\n');
    const incompleteRow = lines.find(
      (l) => l.includes('jtbd-completion') && l.includes('T2'),
    );
    expect(incompleteRow).toBeDefined();
  });

  it('sanitizes | in incomplete verdict reason to prevent table corruption', async () => {
    const resultWithPipe: ScenarioResult = {
      scenarioName: 'pipe-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('my-eval', 'incomplete', 0, 'col1 | col2'),
        ]),
      ],
      aggregated: {
        'my-eval': {
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [resultWithPipe]);

    const [, content] = mockWriteFile.mock.calls[0];
    const incompletesSection = (content as string).split(
      '## ⚠️ Incomplete Verdicts',
    )[1];
    expect(incompletesSection).toBeDefined();
    const rows = incompletesSection!.split('\n').filter((l) => l.startsWith('|'));
    // Skip header and separator rows; find the data row
    const dataRow = rows.find((l) => l.includes('my-eval'));
    expect(dataRow).toBeDefined();
    // Each row must have exactly 4 data columns (5 pipes surrounding them)
    const cells = dataRow!.split('|').filter((c) => c.trim() !== '');
    expect(cells).toHaveLength(4);
  });

  it('sanitizes newlines in incomplete verdict reason', async () => {
    const resultWithNewline: ScenarioResult = {
      scenarioName: 'nl-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('my-eval', 'incomplete', 0, 'line1\nline2'),
        ]),
      ],
      aggregated: {
        'my-eval': {
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [resultWithNewline]);

    const content = mockWriteFile.mock.calls[0][1] as string;
    const incompletesSection = content.split(
      '## \u26a0\ufe0f Incomplete Verdicts',
    )[1];
    expect(incompletesSection).toBeDefined();
    const dataRows = incompletesSection!
      .split('\n')
      .filter((l) => l.startsWith('|') && l.includes('my-eval'));
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]).toContain('line1 line2');
    const cells = dataRows[0].split('|').filter((c) => c.trim() !== '');
    expect(cells).toHaveLength(4);
  });

  it('uses fallback text when incomplete verdict reason is empty', async () => {
    const resultEmpty: ScenarioResult = {
      scenarioName: 'empty-reason',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('my-eval', 'incomplete', 0, '')]),
      ],
      aggregated: {
        'my-eval': {
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 2,
          totalTrials: 2,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [allPass]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).not.toContain('<details>');
  });

  it('omits incomplete verdicts section when none present', async () => {
    const noIncomplete: ScenarioResult = {
      scenarioName: 'clean',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('bug-hit-rate', 'pass')]),
      ],
      aggregated: {
        'bug-hit-rate': {
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    await reporter.write('run-001', [noIncomplete]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).not.toContain('Incomplete Verdicts');
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
    'renders directional verdict in trial table',
    async () => {
      const directional: ScenarioResult = {
        scenarioName: 'latency-check',
        stabilityLevel: 'medium',
        trials: [
          makeTrial(0, [
            makeEvalResult(
              'latency',
              'directional',
              0.75,
            ),
          ]),
        ],
        aggregated: {
          'latency': {
            passingTrials: 0,
            totalTrials: 1,
            aggregateScore: 0.75,
            comparisonMode: 'score',
          },
        },
      };
      const reporter = new MdReporter();
      await reporter.write('run-001', [directional]);

      const [, content] =
        mockWriteFile.mock.calls[0];
      expect(content as string).toContain(
        'directional',
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
    gate: exceeded ? ('warning' as const) : ('pass' as const),
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

  it('shows "(no reason given)" placeholder for fail with empty reason', () => {
    const emptyReasonResult: ScenarioResult = {
      scenarioName: 'empty-reasons',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [
          makeEvalResult('eval-a', 'fail', 0.0, ''),
          makeEvalResult('eval-b', 'fail', 0.5, ''),
        ]),
      ],
      aggregated: {
        'eval-a': {
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
        'eval-b': {
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [nanResult]);
    expect(content).not.toContain('NaN');
  });

  it('does not include incomplete verdict reason in <details> block', () => {
    // incomplete verdicts have their own ## Incomplete Verdicts section;
    // they must not also appear in the per-scenario <details> block
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);

    // BASELINED_RESULT has an incomplete verdict with reason 'Insufficient info'
    // on jtbd-completion T2. It should appear only in the incompletes table,
    // not in the <details> reasoning block.
    const detailsSection = content.split('<details>')[1]?.split('</details>')[0];
    expect(detailsSection).not.toContain('Insufficient info');

    // But the incompletes table should still contain it
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
        makeTrial(1, [makeEvalResult('eval-x', 'fail', 0.5)]),
        makeTrial(2, [makeEvalResult('eval-x', 'pass', 1.0)]),
      ],
      aggregated: {
        'eval-x': {
          passAt1: 0.33,
          passAtK: [{ k: 1, value: 0.33 }, { k: 2, value: 0.56 }],
          passHatK: [{ k: 1, value: 0.33 }, { k: 2, value: 0.0 }],
          passingTrials: 1,
          totalTrials: 3,
          comparisonMode: 'passRate',
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('**Runtime Errors:**');
  });

  it('shows Capture Errors count when transcript has capture errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'capture-errors-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(
          0,
          [makeEvalResult('eval-a', 'pass')],
          [],
          [],
          ['Playwright timeout', 'Output dir failed'],
        ),
      ],
      aggregated: {
        'eval-a': {
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('**Capture Errors:** 2');
  });

  it('omits Capture Errors when transcript has no capture errors', () => {
    const result: ScenarioResult = {
      scenarioName: 'clean-capture',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('eval-a', 'pass')]),
      ],
      aggregated: {
        'eval-a': {
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('**Capture Errors:**');
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
          passAt1: 0,
          passAtK: [{ k: 1, value: 0 }],
          passHatK: [{ k: 1, value: 0 }],
          passingTrials: 0,
          totalTrials: 2,
          comparisonMode: 'passRate',
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

  it('renders — in pass@1, pass@k and pass^k columns when estimators are absent', () => {
    const scoreModeResult: ScenarioResult = {
      scenarioName: 'latency-check',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'directional', 0.75)]),
      ],
      aggregated: {
        'latency': {
          passingTrials: 0,
          totalTrials: 1,
          aggregateScore: 0.75,
          comparisonMode: 'score',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scoreModeResult]);
    const lines = content.split('\n');
    const latencyRow = lines.find((l) =>
      l.startsWith('| latency-check | latency |'));
    expect(latencyRow).toContain('| — | — | — |');
  });

  it('renders numeric vectors for pass-rate evaluator with defined passAtK', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [BASELINED_RESULT]);
    const lines = content.split('\n');
    const bugRow = lines.find((l) =>
      l.startsWith('| build-landing-page | bug-hit-rate |'));
    expect(bugRow).toContain('| 1:1.00; 2:1.00 | 1:1.00; 2:1.00 |');
  });

  it('renders Pass Rate from baselinePassingTrials when passAt1 is undefined (TOST path)', () => {
    const tostResult: ScenarioResult = {
      scenarioName: 'tost-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'directional', 0.5)]),
        makeTrial(1, [makeEvalResult('latency', 'directional', 0.4)]),
        makeTrial(2, [makeEvalResult('latency', 'directional', 0.6)]),
      ],
      aggregated: {
        'latency': {
          passingTrials: 0,
          totalTrials: 3,
          aggregateScore: 0.5,
          comparisonMode: 'score',
          baselinePassingTrials: 3,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [tostResult]);
    const lines = content.split('\n');
    const row = lines.find((l) =>
      l.startsWith('| tost-scenario | latency |'));
    expect(row).toContain('| 3/3 (100%) |');
  });

  it('renders — for all estimators when pass-at-k fields are undefined', () => {
    const noEstimatorsResult: ScenarioResult = {
      scenarioName: 'no-estimators',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('my-eval', 'directional', 0.5)]),
      ],
      aggregated: {
        'my-eval': {
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [noEstimatorsResult]);
    const lines = content.split('\n');
    const row = lines.find((l) =>
      l.startsWith('| no-estimators | my-eval |'));
    expect(row).toContain('| — | — | — |');
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
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
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
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
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

// ── Checklist items breakdown section ───────────────────────

function makeChecklistEvalResult(
  evaluatorName: string,
  items: Array<{ id: string; type: 'invariance' | 'directional'; status: 'pass' | 'fail' | 'incomplete'; reason: string }>,
  hardFailures: string[] = [],
  score = 1.0,
): ReturnType<typeof makeEvalResult> & { details: Record<string, unknown> } {
  return {
    evaluator: evaluatorName,
    score,
    verdict: hardFailures.length > 0 ? 'fail' : 'pass',
    reason: 'checklist result',
    details: {
      _composite: 'binary',
      breakdown: items.map((item) => ({
        evaluator: item.id,
        score: item.status === 'pass' ? 1 : 0,
        verdict: item.status === 'pass' ? 'pass' : item.status === 'fail' ? 'fail' : 'incomplete',
        reason: item.reason,
        scoreable: item.status !== 'incomplete',
      })),
      scoredCount: items.filter((i) => i.status !== 'incomplete').length,
      totalCount: items.length,
      hardFailures,
      ...(items.length > 0 && { items }),
    },
  };
}

describe('MdReporter — checklist items breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('renders a checklist <details> block for an evaluator with details.items', () => {
    const evalResult = makeChecklistEvalResult('output-quality-passrate', [
      { id: 'heading-skips', type: 'invariance', status: 'pass', reason: 'no violations' },
      { id: 'broken-links', type: 'invariance', status: 'fail', reason: '2 broken' },
    ], ['broken-links']);

    const result: ScenarioResult = {
      scenarioName: 'checklist-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [evalResult])],
      aggregated: {
        'output-quality-passrate': {
          passAt1: 0.0,
          passAtK: [{ k: 1, value: 0.0 }],
          passHatK: [{ k: 1, value: 0.0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).toContain('output-quality-passrate checklist');
    expect(content).toContain('heading-skips');
    expect(content).toContain('broken-links');
  });

  it('does not render a checklist block for evaluators without details.items', () => {
    const result: ScenarioResult = {
      scenarioName: 'plain-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [makeEvalResult('bug-hit-rate', 'pass', 1.0)])],
      aggregated: {
        'bug-hit-rate': {
          passAt1: 1.0,
          passAtK: [{ k: 1, value: 1.0 }],
          passHatK: [{ k: 1, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).not.toContain('checklist');
  });

  it('shows per-check status icons across trials', () => {
    const itemsT1 = [
      { id: 'heading-skips', type: 'invariance' as const, status: 'pass' as const, reason: 'ok' },
      { id: 'broken-links', type: 'invariance' as const, status: 'fail' as const, reason: '1 broken' },
    ];
    const itemsT2 = [
      { id: 'heading-skips', type: 'invariance' as const, status: 'pass' as const, reason: 'ok' },
      { id: 'broken-links', type: 'invariance' as const, status: 'pass' as const, reason: 'none' },
    ];

    const result: ScenarioResult = {
      scenarioName: 'multi-trial-checklist',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeChecklistEvalResult('output-quality-passrate', itemsT1, ['broken-links'], 0.5)]),
        makeTrial(1, [makeChecklistEvalResult('output-quality-passrate', itemsT2, [], 1.0)]),
      ],
      aggregated: {
        'output-quality-passrate': {
          passAt1: 0.5,
          passAtK: [{ k: 2, value: 1.0 }],
          passHatK: [{ k: 2, value: 1.0 }],
          passingTrials: 1,
          totalTrials: 2,
          comparisonMode: 'passRate',
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).toContain('heading-skips');
    expect(content).toContain('broken-links');
    expect(content).toContain('✓ pass');
    expect(content).toContain('✗ fail');
  });

  it('shows hard failures line when present', () => {
    const evalResult = makeChecklistEvalResult('output-quality-passrate', [
      { id: 'img-alt', type: 'invariance', status: 'fail', reason: 'missing alts' },
    ], ['img-alt'], 0.0);

    const result: ScenarioResult = {
      scenarioName: 'hard-fail-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [evalResult])],
      aggregated: {
        'output-quality-passrate': {
          passAt1: 0.0,
          passAtK: [{ k: 1, value: 0.0 }],
          passHatK: [{ k: 1, value: 0.0 }],
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'passRate',
        },
      },
    };

    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);

    expect(content).toContain('T1 hard failures: img-alt');
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
    expect(content).toContain('medium (10 trials)');
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
    gate: 'warning' as const,
    stabilityLevel: 'medium' as const,
    evaluators: [],
  },
  trials: [
    makeTrial(0, [{ ...makeEvalResult('latency', 'pass', 0.5, 'Total AAB duration: 500ms across 3 turns'), baselineComparison: 'latency: 0.5 vs baseline 1 (threshold 25%) → pass' }]),
    makeTrial(1, [{ ...makeEvalResult('latency', 'fail', 0.9, 'Total AAB duration: 900ms across 3 turns'), baselineComparison: 'latency: 0.9 vs baseline 1 (threshold 25%) → fail' }]),
  ],
  aggregated: {
    latency: {
      passAt1: 0.5,
      passAtK: [{ k: 1, value: 0.5 }],
      passHatK: [{ k: 1, value: 0.5 }],
      passingTrials: 1,
      totalTrials: 2,
      comparisonMode: 'score',
      aggregateScore: 0.5,
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
    // latency: 1 pass, 1 fail, 0 incomplete → 50% pass rate
    expect(rollupSection).toContain('| latency | 1 | 1 | 0 | 50% |');
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

  it('unenriched (skip-baseline) trials keep directional in per-trial cells and are excluded from rollup', () => {
    const unenriched: ScenarioResult = {
      scenarioName: 'latency-unenriched',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'directional', 0.5)]),
      ],
      aggregated: {
        latency: {
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'score',
          aggregateScore: 0.5,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [unenriched]);
    expect(content).toContain('directional (0.50)');
    // Isolate just the rollup table: it ends before the run-details table
    // (renderRunDetails starts with '| Field | Value |')
    const afterRollupHeading = content.split('### Evaluator rollup (across scenarios)')[1];
    expect(afterRollupHeading).toBeDefined();
    const rollupTableOnly = afterRollupHeading!.split('| Field | Value |')[0];
    expect(rollupTableOnly).not.toContain('| latency |');
  });
});

// ── Git info line ────────────────────────────────────────────────────────────

describe('MdReporter — git info line', () => {
  it('renders git SHA and branch when both are provided', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      gitSha: 'abc1234def567890',
      gitBranch: 'main',
    });
    expect(content).toContain('**Git:**');
    expect(content).toContain('`abc1234`');
    expect(content).toContain('`main`');
  });

  it('truncates SHA to 7 characters', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      gitSha: 'abcdef1234567890',
      gitBranch: 'main',
    });
    expect(content).toContain('`abcdef1`');
    expect(content).not.toContain('`abcdef1234567890`');
  });

  it('renders only SHA when branch is null', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      gitSha: 'abc1234def567890',
      gitBranch: null,
    });
    expect(content).toContain('**Git:**');
    expect(content).toContain('`abc1234`');
    expect(content).not.toContain(' on `');
  });

  it('renders only branch when SHA is null', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      gitSha: null,
      gitBranch: 'feature/my-feature',
    });
    expect(content).toContain('**Git:**');
    expect(content).toContain('`feature/my-feature`');
  });

  it('omits git line when both SHA and branch are null', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      gitSha: null,
      gitBranch: null,
    });
    expect(content).not.toContain('**Git:**');
  });

  it('omits git line when neither gitSha nor gitBranch is provided', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);
    expect(content).not.toContain('**Git:**');
  });
});

// ── TOST statistical metadata in vs. baseline column ────────────────────────

const TOST_META: StatisticalMetadata = {
  method: 'wilson-score',
  margin: 0.30,
  baselineSD: 0.15,
  k: 2.0,
  n: { baseline: 10, current: 5 },
  confidenceInterval: { lower: -0.15, upper: 0.29 },
  nonInferiorityProven: true,
};

function makeRegressionStatusWithTost(
  evaluator: string,
  delta: number,
  exceeded: boolean,
  statistical: StatisticalMetadata,
) {
  const currentScore = 0.8;
  return {
    scenarioName: 'build-landing-page',
    gate: exceeded ? ('fail' as const) : ('pass' as const),
    stabilityLevel: 'medium' as const,
    evaluators: [
      {
        type: 'compared' as const,
        evaluator,
        currentScore,
        baselineScore: currentScore - delta,
        delta,
        exceeded,
        statistical,
      },
    ],
  };
}

describe('MdReporter — TOST statistical metadata in vs. baseline column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('shows TOST check mark when non-inferiority is proven', () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatusWithTost('bug-hit-rate', 0.05, false, TOST_META),
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('TOST \u2713');
  });

  it('shows TOST cross mark when non-inferiority is not proven', () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatusWithTost('bug-hit-rate', -0.33, true, {
        ...TOST_META,
        nonInferiorityProven: false,
        confidenceInterval: { lower: -0.55, upper: -0.11 },
      }),
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('TOST \u2717');
  });

  it('shows CI bounds in vs. baseline cell', () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatusWithTost('bug-hit-rate', 0.05, false, TOST_META),
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('CI -0.15..0.29');
  });

  it('shows margin in vs. baseline cell', () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatusWithTost('bug-hit-rate', 0.05, false, TOST_META),
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('\u00b10.30');
  });

  it('does not show TOST when no statistical metadata is present', () => {
    const result = {
      ...BASELINED_RESULT,
      regressionStatus: makeRegressionStatus('bug-hit-rate', 0.05, false),
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('TOST');
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

// ── Test fixtures for TOST gate/diagnostics tests ────────────────────────────

const TOST_PASS_META: StatisticalMetadata = {
  method: 'wilson-score',
  margin: 0.30,
  baselineSD: 0.15,
  k: 2.0,
  n: { baseline: 10, current: 5 },
  confidenceInterval: { lower: -0.15, upper: 0.29 },
  nonInferiorityProven: true,
};

const TOST_FAIL_META: StatisticalMetadata = {
  method: 'wilson-score',
  margin: 0.30,
  baselineSD: 0.15,
  k: 2.0,
  n: { baseline: 10, current: 5 },
  confidenceInterval: { lower: -0.55, upper: -0.11 },
  nonInferiorityProven: false,
};

function makeResultWithEvaluators(
  gate: 'pass' | 'warning' | 'fail',
  evaluators: RegressionEvalResult[],
): ScenarioResult {
  return {
    ...BASELINED_RESULT,
    regressionStatus: {
      scenarioName: 'build-landing-page',
      gate,
      stabilityLevel: 'medium',
      evaluators,
    },
  };
}

function makeCompared(
  evaluator: string,
  delta: number,
  exceeded: boolean,
  statistical?: StatisticalMetadata,
): RegressionEvalResult {
  const currentScore = 0.8;
  return {
    type: 'compared',
    evaluator,
    currentScore,
    baselineScore: currentScore - delta,
    delta,
    exceeded,
    ...(statistical !== undefined ? { statistical } : {}),
  };
}

function makeSkipped(evaluator: string, skipReason: string): RegressionEvalResult {
  return { type: 'skipped', evaluator, skipReason };
}

// ── TOST config line ──────────────────────────────────────────────────────────

describe('MdReporter — TOST config line', () => {
  it('renders TOST config line when tostConfig is provided', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      tostConfig: { alpha: 0.05, k: 2.0 },
    });
    // JavaScript drops trailing .0 for integers: 2.0 → "2"
    expect(content).toContain('**TOST:** alpha=0.05, k=2');
  });

  it('omits TOST config line when tostConfig is absent', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);
    expect(content).not.toContain('**TOST:**');
  });

  it('renders with non-default alpha and k values', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT], {
      tostConfig: { alpha: 0.10, k: 1.5 },
    });
    expect(content).toContain('**TOST:** alpha=0.1, k=1.5');
  });
});

// ── Scenario gate summary ─────────────────────────────────────────────────────

describe('MdReporter — scenario gate summary', () => {
  it('renders gate=fail with TOST evaluator exceeded', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Regression gate');
    expect(content).toContain('fail');
    expect(content).toContain('regression detected');
  });

  it('renders gate=warning with fallback evaluator exceeded (no statistical)', () => {
    const result = makeResultWithEvaluators('warning', [
      makeCompared('jtbd-completion', -0.30, true),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Regression gate');
    expect(content).toContain('warning');
    expect(content).toContain('threshold fallback');
    expect(content).toContain('exceeded');
  });

  it('renders gate=pass with all passing evaluators — no table', () => {
    const result = makeResultWithEvaluators('pass', [
      makeCompared('jtbd-completion', 0.02, false, TOST_PASS_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Regression gate');
    expect(content).toContain('pass');
    expect(content).not.toContain('regression detected');
    expect(content).not.toContain('threshold fallback');
  });

  it('renders gate summary when evaluators array is empty', () => {
    const result = makeResultWithEvaluators('pass', []);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Regression gate');
  });

  it('renders skipped evaluator in gate table', () => {
    const result = makeResultWithEvaluators('warning', [
      makeSkipped('jtbd-completion', 'eval-version-mismatch'),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('skipped');
    expect(content).toContain('eval-version-mismatch');
  });

  it('escapes pipe in evaluator name within gate table', () => {
    const result = makeResultWithEvaluators('warning', [
      makeCompared('eval|name', -0.30, true),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    // Table should not contain a raw unescaped pipe in the evaluator name cell
    const lines = content.split('\n');
    const evalLine = lines.find((l) => l.includes('eval') && l.includes('name') && l.startsWith('|'));
    expect(evalLine).toBeDefined();
    // Each markdown table row should have exactly 4 pipe chars (3 cols = 4 delimiters)
    const pipeCount = (evalLine!.match(/\|/g) ?? []).length;
    expect(pipeCount).toBe(4);
  });

  it('does not render gate summary when regressionStatus is absent', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);
    expect(content).not.toContain('Regression gate');
  });
});

// ── TOST diagnostics block ────────────────────────────────────────────────────

describe('MdReporter — TOST diagnostics block', () => {
  it('renders diagnostics details block for evaluator with statistical metadata', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('TOST Diagnostics');
    expect(content).toContain('jtbd-completion');
    expect(content).toContain('wilson-score');
  });

  it('renders multiple evaluators in diagnostics block', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
      makeCompared('bug-hit-rate', -0.10, true, {
        ...TOST_FAIL_META,
        method: 'permutation-exact',
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('jtbd-completion');
    expect(content).toContain('bug-hit-rate');
    expect(content).toContain('permutation-exact');
  });

  it('renders nonInferiorityProven=true as proven', () => {
    const result = makeResultWithEvaluators('pass', [
      makeCompared('jtbd-completion', 0.02, false, TOST_PASS_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('proven');
  });

  it('renders nonInferiorityProven=false as not proven', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('not proven');
  });

  it('renders a Power line with achieved power, Cohen’s d, and MDE when present', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, {
        ...TOST_FAIL_META,
        power: { cohensD: 0.25, achievedPower: 0.32, mdeScore: 0.48, targetPower: 0.8 },
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Power: 32%');
    expect(content).toContain("Cohen's d=0.25");
    expect(content).toContain('MDE ±0.48');
    expect(content).toContain('target 80%');
  });

  it('tags an evaluator underpowered when achieved power < target and non-inferiority not proven', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, {
        ...TOST_FAIL_META,
        power: { cohensD: 0.25, achievedPower: 0.32, mdeScore: 0.48, targetPower: 0.8 },
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('underpowered');
  });

  it('does not tag underpowered when achieved power meets target', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, {
        ...TOST_FAIL_META,
        power: { cohensD: 0.9, achievedPower: 0.92, mdeScore: 0.12, targetPower: 0.8 },
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('Power: 92%');
    expect(content).not.toContain('underpowered');
  });

  it('omits the Power line when statistical metadata has no power field', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('TOST Diagnostics');
    expect(content).not.toContain('Power:');
  });

  it('renders MDE as ∞ rather than "Infinity" when mdeScore is non-finite', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, {
        ...TOST_FAIL_META,
        power: { cohensD: 0, achievedPower: 0, mdeScore: Infinity, targetPower: 0.8 },
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('MDE ±∞');
    expect(content).not.toContain('Infinity');
  });

  it('renders margin=0 (uniform-match case) as 0.00', () => {
    const result = makeResultWithEvaluators('pass', [
      makeCompared('jtbd-completion', 0.0, false, {
        ...TOST_PASS_META,
        margin: 0,
        baselineSD: 0,
      }),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('0.00');
  });

  it('renders delta=NaN as em dash', () => {
    const compared = makeCompared('jtbd-completion', 0, false, TOST_PASS_META);
    const withNanDelta = { ...compared, delta: NaN };
    const result = makeResultWithEvaluators('pass', [withNanDelta]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('\u2014');
  });

  it('does not render diagnostics block when no evaluator has statistical metadata', () => {
    const result = makeResultWithEvaluators('warning', [
      makeCompared('jtbd-completion', -0.30, true),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('TOST Diagnostics');
  });

  it('does not render diagnostics block when all evaluators are skipped', () => {
    const result = makeResultWithEvaluators('warning', [
      makeSkipped('jtbd-completion', 'eval-version-mismatch'),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('TOST Diagnostics');
  });

  it('does not render diagnostics block when regressionStatus is absent', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);
    expect(content).not.toContain('TOST Diagnostics');
  });
});

// ── Gate + diagnostics integration ───────────────────────────────────────────

describe('MdReporter — gate summary and diagnostics integration', () => {
  it('gate summary appears before #### Scores in scenario section', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    const gateSummaryPos = content.indexOf('Regression gate');
    const scoresPos = content.indexOf('#### Scores');
    expect(gateSummaryPos).toBeGreaterThan(-1);
    expect(scoresPos).toBeGreaterThan(-1);
    expect(gateSummaryPos).toBeLessThan(scoresPos);
  });

  it('diagnostics appears after evaluator reasoning and before composite breakdown', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    const diagnosticsPos = content.indexOf('TOST Diagnostics');
    const scoresPos = content.indexOf('#### Scores');
    expect(diagnosticsPos).toBeGreaterThan(scoresPos);
  });

  it('renders margin and CI in diagnostics content', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('\u00b10.30');
    expect(content).toContain('-0.55..-0.11');
  });

  it('renders CI bounds from diagnostics', () => {
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.30, true, TOST_FAIL_META),
    ]);
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).toContain('-0.55');
    expect(content).toContain('-0.11');
  });

  it('gate summary and diagnostics both absent when regressionStatus is undefined', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NO_BASELINE_RESULT]);
    expect(content).not.toContain('Regression gate');
    expect(content).not.toContain('TOST Diagnostics');
  });
});

// ── Numeric pass-estimator rendering (seam: producer → reporter) ──────────────

const NUMERIC_ESTIMATOR_RESULT: ScenarioResult = {
  scenarioName: 'numeric-estimators',
  stabilityLevel: 'medium',
  trials: [
    makeTrial(0, [makeEvalResult('jtbd-completion', 'pass')]),
    makeTrial(1, [makeEvalResult('jtbd-completion', 'pass')]),
    makeTrial(2, [makeEvalResult('jtbd-completion', 'fail', 0)]),
    makeTrial(3, [makeEvalResult('jtbd-completion', 'pass')]),
    makeTrial(4, [makeEvalResult('jtbd-completion', 'fail', 0)]),
  ],
  aggregated: {
    'jtbd-completion': {
      passAt1: 0.6,
      passAtK: [{ k: 1, value: 0.6 }, { k: 2, value: 0.9 }, { k: 3, value: 0.97 }],
      passHatK: [{ k: 1, value: 0.6 }, { k: 2, value: 0.3 }, { k: 3, value: 0.1 }],
      passingTrials: 3,
      totalTrials: 5,
      comparisonMode: 'passRate',
    },
  },
};

describe('MdReporter — numeric pass-estimator rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('uses pass@1 / pass@k / pass^k column headers, not a boolean pass column', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NUMERIC_ESTIMATOR_RESULT]);
    expect(content).toContain('| Scenario | Evaluator | pass@1 | pass@k | pass^k | Pass Rate |');
    expect(content).toContain(
      '| Evaluator | pass@1 | pass@k | pass^k | Pass Rate | Mean | Range |',
    );
  });

  it('renders numeric pass@1 in the category matrix', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NUMERIC_ESTIMATOR_RESULT]);
    const matrixRow = content
      .split('\n')
      .find((l) => l.startsWith('| numeric-estimators | jtbd-completion |'));
    expect(matrixRow).toBeDefined();
    expect(matrixRow).toContain('| 0.60 (n=5) |');
  });

  it('renders pass@k and pass^k as semicolon-separated k:value vectors', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NUMERIC_ESTIMATOR_RESULT]);
    expect(content).toContain('1:0.60; 2:0.90; 3:0.97');
    expect(content).toContain('1:0.60; 2:0.30; 3:0.10');
  });

  it('renders no standalone ✓/✗ pass-indicator cell', () => {
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [NUMERIC_ESTIMATOR_RESULT]);
    const matrixRow = content
      .split('\n')
      .find((l) => l.startsWith('| numeric-estimators | jtbd-completion |'));
    expect(matrixRow).toBeDefined();
    expect(matrixRow).not.toContain('✓');
    expect(matrixRow).not.toContain('✗');
  });

  it('renders — for undefined estimators (score-mode without enrichment)', () => {
    const scoreModeResult: ScenarioResult = {
      scenarioName: 'latency-check',
      stabilityLevel: 'medium',
      trials: [makeTrial(0, [makeEvalResult('latency', 'directional', 0.75)])],
      aggregated: {
        latency: {
          passingTrials: 0,
          totalTrials: 1,
          aggregateScore: 0.75,
          comparisonMode: 'score',
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [scoreModeResult]);
    const matrixRow = content
      .split('\n')
      .find((l) => l.startsWith('| latency-check | latency |'));
    expect(matrixRow).toBeDefined();
    expect(matrixRow).toContain('| — | — | — |');
  });
});

// ── Pass-rate comparison (main vs our-change) — 1d ─────────────────────────────

describe('MdReporter — pass-rate comparison (main vs our-change)', () => {
  // Slice out just the comparison section (up to the next ## heading) so later
  // sections that mention evaluator names don't pollute the assertions.
  function passRateSection(content: string): string {
    const start = content.indexOf('## Pass-Rate Comparison');
    if (start === -1) return '';
    const rest = content.slice(start + 3);
    const end = rest.indexOf('\n## ');
    return end === -1 ? content.slice(start) : content.slice(start, start + 3 + end);
  }

  it('renders a side-by-side row with main, our-change, and delta', () => {
    // makeCompared sets currentScore 0.8, baselineScore = 0.8 - delta.
    // delta +0.20 → our-change 80%, main 60%, Δ +20pp.
    const result = makeResultWithEvaluators('pass', [
      makeCompared('jtbd-completion', 0.20, false),
    ]);
    const content = new MdReporter().render('run-001', [result]);

    expect(content).toContain('Pass-Rate Comparison: main vs our-change');
    expect(content).toContain('| Scenario | Evaluator | main | our-change | Δ | Gate |');
    expect(content).toContain('build-landing-page');
    expect(content).toContain('jtbd-completion');
    expect(content).toContain('60%'); // main (baseline)
    expect(content).toContain('80%'); // our-change (current)
    expect(content).toContain('+20pp');
    expect(content).toContain('✓ pass');
  });

  it('flags a regression row and surfaces the fail gate', () => {
    // delta -0.20 → our-change 80%, main 100% (a real, in-range pass rate); the
    // regression marker and fail gate are the load-bearing assertions.
    const result = makeResultWithEvaluators('fail', [
      makeCompared('jtbd-completion', -0.20, true),
    ]);
    const content = new MdReporter().render('run-001', [result]);
    expect(content).toContain('⚠️ -20pp');
    expect(content).toContain('✗ fail');
  });

  it('omits skipped evaluators from the comparison table', () => {
    const result = makeResultWithEvaluators('pass', [
      makeCompared('jtbd-completion', 0.10, false),
      makeSkipped('bug-hit-rate', 'evaluator-version-mismatch'),
    ]);
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toContain('jtbd-completion');
    // bug-hit-rate was skipped → no comparison row for it
    expect(section).not.toMatch(/\| build-landing-page \| bug-hit-rate \|/);
  });

  it('excludes score-mode evaluators (aggregate score, not a pass rate)', () => {
    // Mark jtbd-completion score-mode in the aggregated map; its compared
    // result must be omitted from the pass-rate table and counted in a note.
    const base = makeResultWithEvaluators('pass', [
      makeCompared('bug-hit-rate', 0.10, false),
      makeCompared('jtbd-completion', 0.20, false),
    ]);
    const result: ScenarioResult = {
      ...base,
      aggregated: {
        'bug-hit-rate': base.aggregated['bug-hit-rate'],
        'jtbd-completion': {
          ...base.aggregated['jtbd-completion'],
          comparisonMode: 'score',
        },
      },
    };
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toMatch(/\| build-landing-page \| bug-hit-rate \|/);
    expect(section).not.toMatch(/\| build-landing-page \| jtbd-completion \|/);
    expect(section).toContain('score-mode evaluator');
  });

  it('excludes evaluators with no main-baseline data (NaN baseline) instead of showing a green pass', () => {
    // A newly-added evaluator the main baseline predates: comparator returns a
    // type:'compared' result with baselineScore/delta = NaN, exceeded=false.
    // It must NOT render as "— | 80% | — | ✓ pass" (untraced green evidence).
    const noBaselineData: RegressionEvalResult = {
      type: 'compared',
      evaluator: 'skill-selection',
      currentScore: 0.8,
      baselineScore: NaN,
      delta: NaN,
      exceeded: false,
    };
    const result = makeResultWithEvaluators('pass', [
      makeCompared('bug-hit-rate', 0.10, false),
      noBaselineData,
    ]);
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toMatch(/\| build-landing-page \| bug-hit-rate \|/);
    // skill-selection has no baseline → excluded from the table, footnoted
    expect(section).not.toMatch(/\| build-landing-page \| skill-selection \|/);
    expect(section).toContain('main baseline has no data');
  });

  it('omits the comparison section entirely when no scenario was gated', () => {
    const content = new MdReporter().render('run-001', [NO_BASELINE_RESULT]);
    // No gated scenario → renderPassRateComparison isn't invoked, so the
    // section header is never emitted (distinct from the empty-state note,
    // which only appears when there ARE gated scenarios but no comparable rows).
    expect(content).not.toContain('Pass-Rate Comparison: main vs our-change');
  });

  it('renders the empty-state note (score-mode why) when every gated evaluator is score-mode', () => {
    // A gated scenario whose only compared evaluator is score-mode: the header
    // IS emitted (scenario is gated), but there are no rows → empty-state note.
    const base = makeResultWithEvaluators('pass', [
      makeCompared('token-usage', 0.20, false),
    ]);
    const result: ScenarioResult = {
      ...base,
      aggregated: {
        'token-usage': { ...base.aggregated['jtbd-completion'], comparisonMode: 'score' },
      },
    };
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toContain('Pass-Rate Comparison: main vs our-change');
    expect(section).toContain('No pass-rate rows to compare');
    expect(section).toContain('score-mode');
    // The exact excluded count is preserved in the empty-state via the footnote.
    expect(section).toContain('1 score-mode evaluator');
  });

  it('renders the empty-state note (no-baseline why) when every gated evaluator lacks baseline data', () => {
    const noBaselineData: RegressionEvalResult = {
      type: 'compared',
      evaluator: 'skill-selection',
      currentScore: 0.8,
      baselineScore: NaN,
      delta: NaN,
      exceeded: false,
    };
    const result = makeResultWithEvaluators('warning', [noBaselineData]);
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toContain('No pass-rate rows to compare');
    expect(section).toContain('re-capture the main baseline');
    expect(section).toContain('1 evaluator(s) are omitted');
  });

  it('renders the warning gate icon on a comparison row', () => {
    const result = makeResultWithEvaluators('warning', [
      makeCompared('jtbd-completion', 0.10, false),
    ]);
    const section = passRateSection(new MdReporter().render('run-001', [result]));
    expect(section).toContain('⚠️ warning');
  });
});

// ── Wilson CI rendering in reporter ──────────────────────────────────────────

describe('MdReporter — Wilson CI in pass@1 cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  const wilsonCI: WilsonCI = { lower: 0.23, upper: 0.88, n: 5 };

  it('renders CI in category matrix for pass-rate evaluator', () => {
    const result: ScenarioResult = {
      scenarioName: 'ci-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(1, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(2, [makeEvalResult('jtbd-completion', 'fail', 0)]),
        makeTrial(3, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(4, [makeEvalResult('jtbd-completion', 'fail', 0)]),
      ],
      aggregated: {
        'jtbd-completion': {
          comparisonMode: 'passRate',
          passAt1: 0.60,
          passAtK: [{ k: 1, value: 0.60 }],
          passHatK: [{ k: 1, value: 0.60 }],
          passingTrials: 3,
          totalTrials: 5,
          wilsonCI,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    const matrixRow = content
      .split('\n')
      .find((l) => l.startsWith('| ci-scenario | jtbd-completion |'));
    expect(matrixRow).toBeDefined();
    expect(matrixRow).toContain('0.60 (n=5) [0.23, 0.88]');
  });

  it('renders CI in per-scenario table for pass-rate evaluator', () => {
    const result: ScenarioResult = {
      scenarioName: 'ci-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(1, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(2, [makeEvalResult('jtbd-completion', 'fail', 0)]),
        makeTrial(3, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(4, [makeEvalResult('jtbd-completion', 'fail', 0)]),
      ],
      aggregated: {
        'jtbd-completion': {
          comparisonMode: 'passRate',
          passAt1: 0.60,
          passAtK: [{ k: 1, value: 0.60 }],
          passHatK: [{ k: 1, value: 0.60 }],
          passingTrials: 3,
          totalTrials: 5,
          wilsonCI,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    const perScenarioRow = content
      .split('\n')
      .find((l) => l.startsWith('| jtbd-completion |') && l.includes('0.60'));
    expect(perScenarioRow).toBeDefined();
    expect(perScenarioRow).toContain('0.60 (n=5) [0.23, 0.88]');
  });

  it('omits CI for score-mode evaluator (wilsonCI undefined)', () => {
    const result: ScenarioResult = {
      scenarioName: 'score-ci-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('latency', 'directional', 0.5)]),
      ],
      aggregated: {
        latency: {
          passingTrials: 0,
          totalTrials: 1,
          comparisonMode: 'score',
          aggregateScore: 0.5,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    expect(content).not.toContain('[0.');
  });

  it('renders n without CI when wilsonCI is absent but totalTrials is defined', () => {
    const result: ScenarioResult = {
      scenarioName: 'n-only-scenario',
      stabilityLevel: 'medium',
      trials: [
        makeTrial(0, [makeEvalResult('jtbd-completion', 'pass')]),
        makeTrial(1, [makeEvalResult('jtbd-completion', 'fail', 0)]),
        makeTrial(2, [makeEvalResult('jtbd-completion', 'pass')]),
      ],
      aggregated: {
        'jtbd-completion': {
          comparisonMode: 'passRate',
          passAt1: 0.67,
          passAtK: [{ k: 1, value: 0.67 }],
          passHatK: [{ k: 1, value: 0.67 }],
          passingTrials: 2,
          totalTrials: 3,
        },
      },
    };
    const reporter = new MdReporter();
    const content = reporter.render('run-001', [result]);
    const matrixRow = content
      .split('\n')
      .find((l) => l.startsWith('| n-only-scenario | jtbd-completion |'));
    expect(matrixRow).toBeDefined();
    expect(matrixRow).toContain('0.67 (n=3)');
    expect(matrixRow).not.toContain('[');
  });
});
