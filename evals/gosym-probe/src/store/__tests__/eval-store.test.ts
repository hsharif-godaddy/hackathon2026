import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../../config/environments/types.js';
import type { DOMSnapshot } from '../../clients/dom-capture.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { Scenario } from '../../scenarios/types.js';
import type { CapturedSite } from '../../clients/site-capture/types.js';
import type {
  RunIndex,
  RunMetadata,
  StoredTranscript,
  StoredAggregated,
  StoredToolCallSummary,
  StoredArtifactManifest,
} from '../types.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn().mockResolvedValue({
    stdout: 'abc123def456\n',
    stderr: '',
  }),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

vi.mock('../../reporters/md-reporter.js');
vi.mock('../../reporters/narrative-summary.js');
vi.mock('../../util/conversation-renderer.js', () => ({
  renderConversation: vi.fn().mockReturnValue({
    scenarioName: 'test-scenario',
    trial: 1,
    turns: [{ role: 'user', content: 'hello', durationSeconds: 0 }],
    summary: { messageCount: 1, totalElapsedSeconds: 0 },
  }),
}));

import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import {
  MdReporter,
  renderTrialEvalResultsMarkdown,
} from '../../reporters/md-reporter.js';
import { NarrativeSummaryReporter } from '../../reporters/narrative-summary.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import {
  renderConversation,
} from '../../util/conversation-renderer.js';
import { EvalStore } from '../eval-store.js';

const mockRenderConversation = vi.mocked(renderConversation);

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);
const mockRenderTrialEvalResultsMarkdown = vi.mocked(
  renderTrialEvalResultsMarkdown,
);
const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockReaddir =
  readdir as unknown as ReturnType<typeof vi.fn>;
const mockRename = vi.mocked(rename);
const mockRm = vi.mocked(rm);
const mockExecFile = mockExecFileAsync;

// Fixed timestamp for deterministic directory names
const FIXED_ISO = '2026-04-13T14:30:25.000Z';
const FIXED_COMPACT = '20260413143025';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(): Config {
  return {
    env: 'test',
    aab: {
      agentsUrl: 'http://test',
      bffUrl: 'http://test',
      controlPlaneUrl: 'http://test',
    },
    gocode: {
      baseUrl: 'http://test',
      apiKey: 'test-key',
      model: 'test-model',
    },
    eval: { defaultTrials: 2, maxTurns: 5, turnTimeoutMs: 5000 },
    playwright: { ignoreHttpsErrors: false },
    regression: { alpha: 0.05, k: 2.0, minMarginFraction: 0.05, fallbackThresholds: { thresholds: {}, defaultThreshold: 0.1 } },
  };
}

function makeDOMSnapshot(i: number = 0): DOMSnapshot {
  return {
    url: `https://example.com/page-${i}`,
    htmlPath: `/tmp/run/snapshots/${i}.html`,
    screenshotPath: `/tmp/run/snapshots/${i}.png`,
    timestamp: `2026-04-09T00:0${i}:00.000Z`,
    consoleLogs: [],
  };
}

function makeTrialResult(
  trialIndex: number = 0,
  snapshots: DOMSnapshot[] = [],
  scores: number[] = [0.8],
): TrialResult {
  const evalResults: EvalResult[] = scores.map((score, i) => ({
    evaluator: i === 0 ? 'test-evaluator' : `evaluator-${i}`,
    score,
    verdict: score >= 0.5 ? 'pass' : 'fail',
    reason: score >= 0.5 ? 'passed' : 'failed',
  }));

  return {
    trialIndex,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex,
      turns: [
        {
          role: 'user',
          content: 'Hello',
          toolCalls: [],
          timestamp: 1000 + trialIndex * 2000,
        },
        {
          role: 'assistant',
          content: 'Response',
          toolCalls: [],
          timestamp: 3000 + trialIndex * 2000,
        },
      ],
      snapshots,
      errors: [],
      captureErrors: [],
      
    },
    evalResults,
  };
}

function makeScenario(
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    name: 'test-scenario',
    trials: 2,
    persona: {
      name: 'Test User',
      description: 'A test user',
      systemPrompt: 'You are helpful.',
    },
    goals: [{ description: 'Do a thing', assertion: 'positive' }],
    evaluators: [
      {
        name: 'test-evaluator',
        evaluate: vi.fn(),
      },
    ],
    ...overrides,
  };
}

function makeScenarioResult(
  scenario: Scenario,
  trials: TrialResult[],
): ScenarioResult {
  return {
    scenarioName: scenario.name,
    stabilityLevel: 'medium',
    trials,
    aggregated: {
      'test-evaluator': {
        passAtK: true,
        passToTheK: true,
        passingTrials: trials.length,
        totalTrials: trials.length,
      },
    },
  };
}

function makeTrialResultWithReadFile(
  trialIndex: number = 0,
): TrialResult {
  return {
    trialIndex,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex,
      turns: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'readFile',
              input: { file_path: '/src/Header.tsx' },
              output: '     1\tconst x = 1;',
              startTime: 1000,
              endTime: 1100,
            },
          ],
          timestamp: 1000,
        },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
      
    },
    evalResults: [
      {
        evaluator: 'test-evaluator',
        score: 0.8,
        verdict: 'pass',
        reason: 'passed',
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EvalStore', () => {
  let mockRender: ReturnType<typeof vi.fn>;
  let mockNarrativeRender: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date(FIXED_ISO));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'ENOENT' }),
    );
    mockReaddir.mockResolvedValue([]);
    mockRender = vi.fn().mockReturnValue('# mock summary');
    vi.mocked(MdReporter).mockImplementation(
      function () { return ({ render: mockRender }) as unknown as MdReporter; },
    );
    mockNarrativeRender = vi.fn().mockResolvedValue('# narrative summary');
    vi.mocked(NarrativeSummaryReporter).mockImplementation(
      function () { return ({ render: mockNarrativeRender }) as unknown as NarrativeSummaryReporter; },
    );
    mockRenderTrialEvalResultsMarkdown.mockReturnValue(
      '## mock eval results\n',
    );
    mockRenderConversation.mockReturnValue({
      scenarioName: 'test-scenario',
      trial: 1,
      turns: [{ role: 'user', content: 'hello', durationSeconds: 0 }],
      summary: { messageCount: 1, totalElapsedSeconds: 0 },
    });
  });

  describe('save()', () => {
    it('creates run, scenario, and trial/snapshots directories', async () => {
      const store = new EvalStore();
      const snapshot = makeDOMSnapshot();
      const trial = makeTrialResult(0, [snapshot]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001`,
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/scenarios/test-scenario`,
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/scenarios/test-scenario` +
        '/trials/0/snapshots',
        { recursive: true },
      );
    });

    it('writes run-metadata.json with required fields', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const trial = makeTrialResult();
      const result = makeScenarioResult(scenario, [trial]);
      const config = makeConfig();

      await store.save('run-001', [result], [scenario], config);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.runId).toBe('run-001');
      expect(typeof parsed.timestamp).toBe('string');
      expect(parsed.gitSha).toBe('abc123def456');
      expect(parsed.scenarios).toEqual(['test-scenario']);
      expect(parsed.config.gocode.apiKey).toBeUndefined();
      expect(parsed.config.gocode.baseUrl).toBe(
        config.gocode.baseUrl,
      );
      expect(parsed.config.gocode.model).toBe(config.gocode.model);
      expect(parsed.config.env).toBe(config.env);
      expect(parsed.config.aab).toEqual(config.aab);
      expect(parsed.config.eval).toEqual(config.eval);
      expect(parsed.maxTurns).toBe(config.eval.maxTurns);
      expect(parsed.trialsOverride).toBeUndefined();
    });

    it('includes trialsOverride in run-metadata.json when provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save(
        'run-001', [result], [scenario], makeConfig(), { trialsOverride: 5 },
      );

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.trialsOverride).toBe(5);
    });

    it('uses null gitSha when git is unavailable (not a repo)', async () => {
      const gitError = Object.assign(
        new Error('fatal: not a git repository'),
        { code: 128 },
      );
      mockExecFile.mockRejectedValueOnce(gitError);
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitSha).toBeNull();
    });

    it('uses null gitSha when git binary not found (ENOENT)', async () => {
      const enoentError = Object.assign(
        new Error('spawn git ENOENT'),
        { code: 'ENOENT' },
      );
      mockExecFile.mockRejectedValueOnce(enoentError);
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitSha).toBeNull();
    });

    it('logs warning for unexpected git sha error (e.g. permissions)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      const unexpectedError = Object.assign(
        new Error('permission denied'),
        { code: 1 },
      );
      mockExecFile.mockRejectedValueOnce(unexpectedError);
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitSha).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[EvalStore] Unexpected git error resolving HEAD sha',
        expect.objectContaining({ error: 'permission denied' }),
      );
      warnSpy.mockRestore();
    });

    it('writes gitBranch to run-metadata.json', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: 'feature/my-branch\n', stderr: '' });
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitBranch).toBe('feature/my-branch');
    });

    it('trims whitespace from gitBranch', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '  main  \n', stderr: '' });
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitBranch).toBe('main');
    });

    it('uses null gitBranch when git branch command is unavailable', async () => {
      const gitError = Object.assign(
        new Error('fatal: not a git repository'),
        { code: 128 },
      );
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
      mockExecFile.mockRejectedValueOnce(gitError);
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitBranch).toBeNull();
    });

    it('logs warning for unexpected git branch error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
      const unexpectedError = Object.assign(
        new Error('git index corrupted'),
        { code: 1 },
      );
      mockExecFile.mockRejectedValueOnce(unexpectedError);
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitBranch).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[EvalStore] Unexpected git error resolving branch',
        expect.objectContaining({ error: 'git index corrupted' }),
      );
      warnSpy.mockRestore();
    });

    it('stores detached HEAD literal as gitBranch', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: 'HEAD\n', stderr: '' });
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.gitBranch).toBe('HEAD');
    });

    it('writes scenario-config.json with serialized scenario', async () => {
      const store = new EvalStore();
      const scenario = makeScenario({
        expectedTools: [{ tool: 'search', called: true }],
      });
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('scenario-config.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.name).toBe('test-scenario');
      expect(parsed.trials).toBe(2);
      expect(parsed.evaluators).toEqual(['test-evaluator']);
      expect(parsed.expectedTools).toEqual([
        { tool: 'search', called: true },
      ]);
    });

    it('omits systemPrompt from scenario-config.json persona', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('scenario-config.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.persona).not.toHaveProperty('systemPrompt');
      expect(parsed.persona.name).toBe('Test User');
      expect(parsed.persona.description).toBe('A test user');
    });

    it('writes transcript.json with snapshotCount, no binary data', async () => {
      const store = new EvalStore();
      const snapshots = [makeDOMSnapshot(0), makeDOMSnapshot(1)];
      const trial = makeTrialResult(0, snapshots);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('transcript.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.scenarioName).toBe('test-scenario');
      expect(parsed.trialIndex).toBe(0);
      expect(parsed.turns).toHaveLength(2);
      expect(parsed.snapshotCount).toBe(2);
      expect(parsed.errors).toEqual([]);
      expect(parsed).not.toHaveProperty('snapshots');
    });

    it('writes eval-results.json per trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0, [], [0.8]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string) as EvalResult[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].evaluator).toBe('test-evaluator');
      expect(parsed[0].score).toBe(0.8);
      expect(parsed[0].verdict).toBe('pass');
    });

    it('writes eval-results.md per trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0, [], [0.8]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.md'),
      );
      expect(call).toBeDefined();
      expect(call![1]).toBe('## mock eval results\n');
      expect(mockRenderTrialEvalResultsMarkdown).toHaveBeenCalledWith(trial);
    });

    it('writes tool_calls.json per trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0, [], [0.8]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('tool_calls.json'),
      );
      expect(call).toBeDefined();
      expect(
        (call![0] as string).includes('trials/0'),
      ).toBe(true);
      const parsed = JSON.parse(
        call![1] as string,
      ) as StoredToolCallSummary;
      expect(parsed).toHaveProperty('sequence');
      expect(parsed).toHaveProperty('totalCount');
      expect(parsed).toHaveProperty('uniqueTools');
      expect(parsed).toHaveProperty('uniqueCount');
      expect(parsed).toHaveProperty('countByTool');
      expect(parsed.totalCount).toBe(0);
      expect(parsed.sequence).toEqual([]);
    });

    it('creates artifacts dir and writes files when artifacts exist', async () => {
      const store = new EvalStore();
      const trial = makeTrialResultWithReadFile(0);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/scenarios/test-scenario` +
          '/trials/0/artifacts',
        { recursive: true },
      );
      const artifactFileCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('0-Header.tsx'),
      );
      expect(artifactFileCall).toBeDefined();
      expect(artifactFileCall![1]).toBe('const x = 1;');
    });

    it('writes artifacts.json manifest when artifacts exist', async () => {
      const store = new EvalStore();
      const trial = makeTrialResultWithReadFile(0);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const manifestCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('artifacts/artifacts.json'),
      );
      expect(manifestCall).toBeDefined();
      const parsed = JSON.parse(
        manifestCall![1] as string,
      ) as StoredArtifactManifest;
      expect(parsed.totalCount).toBe(1);
      expect(parsed.artifacts[0].toolName).toBe('readFile');
      expect(parsed.artifacts[0].filename).toBe('0-Header.tsx');
    });

    it('skips artifacts dir when no extractable tool calls', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const artifactsDirCall = mockMkdir.mock.calls.find(([p]) =>
        (p as string).endsWith('artifacts'),
      );
      expect(artifactsDirCall).toBeUndefined();
      const manifestCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('artifacts.json'),
      );
      expect(manifestCall).toBeUndefined();
    });

    it(
      'does not write .png/.html for snapshots ' +
        '(SiteCapture writes those directly)',
      async () => {
        const store = new EvalStore();
        const snapshot = makeDOMSnapshot(0);
        const trial = makeTrialResult(0, [snapshot]);
        const scenario = makeScenario();
        const result = makeScenarioResult(scenario, [trial]);

        await store.save('run-001', [result], [scenario], makeConfig());

        const pngCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.png'),
        );
        const htmlCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.html'),
        );
        expect(pngCall).toBeUndefined();
        expect(htmlCall).toBeUndefined();
      },
    );

    it('writes .meta.json with url and timestamp for each snapshot', async () => {
      const store = new EvalStore();
      const snapshot = makeDOMSnapshot(0);
      const trial = makeTrialResult(0, [snapshot]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const metaCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('0.meta.json'),
      );
      expect(metaCall).toBeDefined();
      const parsed = JSON.parse(metaCall![1] as string);
      expect(parsed.index).toBe(0);
      expect(parsed.url).toBe(snapshot.url);
      expect(parsed.timestamp).toBe(snapshot.timestamp);
    });

    it('writes console-logs.json for each snapshot', async () => {
      const store = new EvalStore();
      const snapshot = makeDOMSnapshot(0);
      snapshot.consoleLogs = [
        {
          type: 'error',
          text: 'Uncaught ReferenceError: x is not defined',
        },
        { type: 'warn', text: 'Deprecated API' },
      ];
      const trial = makeTrialResult(0, [snapshot]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('0.console-logs.json'),
      );
      expect(call).toBeDefined();
      expect(
        (call![0] as string).includes('snapshots'),
      ).toBe(true);
      const parsed = JSON.parse(call![1] as string);
      expect(parsed).toEqual([
        {
          type: 'error',
          text: 'Uncaught ReferenceError: x is not defined',
        },
        { type: 'warn', text: 'Deprecated API' },
      ]);
    });

    it('writes empty array when no console logs', async () => {
      const store = new EvalStore();
      const snapshot = makeDOMSnapshot(0);
      const trial = makeTrialResult(0, [snapshot]);
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [trial]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('0.console-logs.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed).toEqual([]);
    });

    it('writes aggregated.json with evaluator summaries and timing', async () => {
      const store = new EvalStore();
      const trials = [
        makeTrialResult(0, [], [0.4]),
        makeTrialResult(1, [], [1.0]),
      ];
      const scenario = makeScenario();
      const result: ScenarioResult = {
        scenarioName: scenario.name,
        stabilityLevel: 'medium',
        trials,
        aggregated: {
          'test-evaluator': {
            passAtK: true,
            passToTheK: false,
            passingTrials: 1,
            totalTrials: 2,
          },
        },
      };

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.scenarioName).toBe('test-scenario');

      const evalSummary = parsed.evaluators['test-evaluator'];
      expect(evalSummary.passAtK).toBe(true);
      expect(evalSummary.passToTheK).toBe(false);
      expect(evalSummary.passingTrials).toBe(1);
      expect(evalSummary.totalTrials).toBe(2);
      expect(evalSummary.scores.min).toBeCloseTo(0.4);
      expect(evalSummary.scores.max).toBeCloseTo(1.0);
      expect(evalSummary.scores.mean).toBeCloseTo(0.7);
      expect(evalSummary.scores.median).toBeCloseTo(0.7);
      expect(evalSummary.scores.stddev).toBeCloseTo(0.3);
      expect(evalSummary.verdicts).toEqual({ pass: 1, fail: 1 });

      expect(parsed.timing.totalDurationMs).toBe(4000);
      expect(parsed.timing.avgTrialDurationMs).toBe(2000);
      expect(parsed.timing.avgTurnsPerTrial).toBe(2);
    });

    it('omits passAtK and passToTheK from aggregated.json for score-mode evaluator', async () => {
      const store = new EvalStore();
      const trial: TrialResult = {
        trialIndex: 0,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex: 0,
          turns: [
            {
              role: 'user',
              content: 'Go',
              toolCalls: [],
              timestamp: 1000,
            },
            {
              role: 'assistant',
              content: 'Done',
              toolCalls: [],
              timestamp: 3000,
            },
          ],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults: [
          {
            evaluator: 'test-evaluator',
            score: 0.75,
            verdict: 'observed',
            reason: 'measured',
          },
        ],
      };
      const scenario = makeScenario();
      const result: ScenarioResult = {
        scenarioName: scenario.name,
        stabilityLevel: 'medium',
        trials: [trial],
        aggregated: {
          'test-evaluator': {
            passingTrials: 0,
            totalTrials: 1,
            aggregateScore: 0.75,
            regressionMode: 'score',
            lowerIsBetter: true,
          },
        },
      };

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      const evalSummary = parsed.evaluators['test-evaluator'];
      expect(evalSummary).not.toHaveProperty('passAtK');
      expect(evalSummary).not.toHaveProperty('passToTheK');
      expect(evalSummary.passingTrials).toBe(0);
      expect(evalSummary.totalTrials).toBe(1);
      expect(evalSummary.lowerIsBetter).toBe(true);
    });

    it('persists evalVersion in aggregated.json when present', async () => {
      const store = new EvalStore();
      const trial: TrialResult = {
        trialIndex: 0,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex: 0,
          turns: [
            {
              role: 'user',
              content: 'Go',
              toolCalls: [],
              timestamp: 1000,
            },
            {
              role: 'assistant',
              content: 'Done',
              toolCalls: [],
              timestamp: 3000,
            },
          ],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults: [
          {
            evaluator: 'test-evaluator',
            score: 0.9,
            verdict: 'pass',
            reason: 'ok',
          },
        ],
      };
      const scenario = makeScenario();
      const result: ScenarioResult = {
        scenarioName: scenario.name,
        stabilityLevel: 'medium',
        trials: [trial],
        aggregated: {
          'test-evaluator': {
            passAtK: true,
            passToTheK: true,
            passingTrials: 1,
            totalTrials: 1,
            evalVersion: '2.0',
          },
        },
      };

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      const evalSummary = parsed.evaluators['test-evaluator'];
      expect(evalSummary.evalVersion).toBe('2.0');
    });

    it('omits evalVersion from aggregated.json when undefined', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      const evalSummary = parsed.evaluators['test-evaluator'];
      expect(evalSummary).not.toHaveProperty('evalVersion');
    });

    it('includes regressionStatus in aggregated.json when present', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const trial = makeTrialResult();
      const regressionStatus = {
        scenarioName: 'test-scenario',
        gate: 'pass' as const,
        stabilityLevel: 'medium' as const,
        evaluators: [],
      };
      const result: ScenarioResult = {
        ...makeScenarioResult(scenario, [trial]),
        regressionStatus,
      };

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.regressionStatus).toEqual(regressionStatus);
    });

    it('omits regressionStatus from aggregated.json when absent', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed).not.toHaveProperty('regressionStatus');
    });

    it('writes aggregate-report.md using MdReporter.render()', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];

      await store.save('run-001', results, [scenario], makeConfig());

      expect(mockRender).toHaveBeenCalledWith('run-001', results, { runMode: 'eval' });
      const summaryCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregate-report.md'),
      );
      expect(summaryCall).toBeDefined();
      expect(summaryCall![1]).toBe('# mock summary');
    });

    it('creates .run-index.json on first save with dir field', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      expect(tmpCall).toBeDefined();
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs).toHaveLength(1);
      expect(parsed.runs[0].runId).toBe('run-001');
      expect(typeof parsed.runs[0].timestamp).toBe('string');
      expect(parsed.runs[0].dir).toBe(`${FIXED_COMPACT}_run-001`);
      expect(mockRename).toHaveBeenCalledWith(
        tmpCall![0],
        'runs/.run-index.json',
      );
    });

    it('prepends to .run-index.json on subsequent saves', async () => {
      const store = new EvalStore();
      const existing: RunIndex = {
        runs: [{
          runId: 'run-000',
          timestamp: '2026-04-08T00:00:00.000Z',
          dir: '20260408000000_run-000',
        }],
      };
      // finalizeRun order: metadata read (ENOENT default), then index read
      mockReadFile
        .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }))
        .mockResolvedValueOnce(JSON.stringify(existing));

      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      await store.save('run-001', [result], [scenario], makeConfig());

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs).toHaveLength(2);
      expect(parsed.runs[0].runId).toBe('run-001');
      expect(parsed.runs[1].runId).toBe('run-000');
    });

    it('returns the run directory path', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      const path = await store.save(
        'run-001', [result], [scenario], makeConfig(),
      );

      expect(path).toBe(`runs/${FIXED_COMPACT}_run-001`);
    });

    it('writes kind to run-metadata.json when provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.save(
        'run-001', [result], [scenario], makeConfig(), { kind: 'graduation' },
      );

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.kind).toBe('graduation');
    });

    it('omits kind from run-metadata.json when not provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.save('run-001', [result], [scenario], makeConfig());

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed).not.toHaveProperty('kind');
    });

    it('writes kind to run-index entry when provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.save(
        'run-001', [result], [scenario], makeConfig(), { kind: 'graduation' },
      );

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs[0].kind).toBe('graduation');
    });

    it('omits kind from run-index entry when not provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.save('run-001', [result], [scenario], makeConfig());

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs[0]).not.toHaveProperty('kind');
    });

    it('handles empty results array', async () => {
      const store = new EvalStore();

      const path = await store.save('run-001', [], [], makeConfig());

      expect(path).toBe(`runs/${FIXED_COMPACT}_run-001`);
      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001`,
        { recursive: true },
      );
      const metaCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      expect(metaCall).toBeDefined();
      const parsed = JSON.parse(metaCall![1] as string);
      expect(parsed.scenarios).toEqual([]);
    });

    it('respects custom runsDir', async () => {
      const store = new EvalStore('/custom/runs');
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);

      const path = await store.save(
        'run-001', [result], [scenario], makeConfig(),
      );

      expect(path).toBe(`/custom/runs/${FIXED_COMPACT}_run-001`);
      expect(mockMkdir).toHaveBeenCalledWith(
        `/custom/runs/${FIXED_COMPACT}_run-001`,
        { recursive: true },
      );
      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      expect((tmpCall![0] as string).startsWith('/custom/runs')).toBe(
        true,
      );
    });
    it('uses provided dirName and skips initRun when dirName is given',
      async () => {
        const store = new EvalStore();
        const scenario = makeScenario();
        const trial = makeTrialResult(0);
        const result = makeScenarioResult(scenario, [trial]);

        const path = await store.save(
          'run-001',
          [result],
          [scenario],
          makeConfig(),
          { dirName: 'custom-dir-name' },
        );

        expect(path).toBe('runs/custom-dir-name');
        // initRun creates the run root dir; with dirName provided it must not
        expect(mockMkdir).not.toHaveBeenCalledWith(
          'runs/custom-dir-name',
          { recursive: true },
        );
      },
    );

    it('forwards gocode from RunOptions to narrative reporter', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(scenario, [makeTrialResult()]);
      const mockGocode = { complete: vi.fn() } as unknown as IGocodeClient;

      await store.save('run-001', [result], [scenario], makeConfig(), { gocode: mockGocode });

      expect(mockNarrativeRender).toHaveBeenCalled();
      const summaryCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('summary.md'),
      );
      expect(summaryCall).toBeDefined();
    });
  });

  describe('ensureTrialDir()', () => {
    it('mkdirs and returns the trial directory path', async () => {
      const store = new EvalStore();
      const dirName = `${FIXED_COMPACT}_run-001`;
      const path = await store.ensureTrialDir(dirName, 'my-scenario', 3);

      expect(path).toBe(
        `runs/${FIXED_COMPACT}_run-001/scenarios/my-scenario/trials/3`,
      );
      expect(mockMkdir).toHaveBeenCalledWith(path, { recursive: true });
    });

    it('honours a custom runsDir', async () => {
      const store = new EvalStore('/custom/runs');
      const dirName = `${FIXED_COMPACT}_run-001`;
      const path = await store.ensureTrialDir(dirName, 'my-scenario', 0);

      expect(path).toBe(
        `/custom/runs/${FIXED_COMPACT}_run-001/scenarios/my-scenario` +
        '/trials/0',
      );
    });
  });

  describe('prune()', () => {
    it('is a no-op when runs are under the limit', async () => {
      const store = new EvalStore('runs', 3);
      const index: RunIndex = {
        runs: [
          {
            runId: 'run-002',
            timestamp: '2026-04-09T02:00:00.000Z',
            dir: '20260409020000_run-002',
          },
          {
            runId: 'run-001',
            timestamp: '2026-04-09T01:00:00.000Z',
            dir: '20260409010000_run-001',
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));

      const pruned = await store.prune();

      expect(pruned).toEqual([]);
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('removes oldest run dirs when over limit', async () => {
      const store = new EvalStore('runs', 2);
      const index: RunIndex = {
        runs: [
          {
            runId: 'run-003',
            timestamp: '2026-04-09T03:00:00.000Z',
            dir: '20260409030000_run-003',
          },
          {
            runId: 'run-002',
            timestamp: '2026-04-09T02:00:00.000Z',
            dir: '20260409020000_run-002',
          },
          {
            runId: 'run-001',
            timestamp: '2026-04-09T01:00:00.000Z',
            dir: '20260409010000_run-001',
          },
          {
            runId: 'run-000',
            timestamp: '2026-04-09T00:00:00.000Z',
            dir: '20260409000000_run-000',
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));

      await store.prune();

      expect(mockRm).toHaveBeenCalledWith(
        'runs/20260409010000_run-001',
        { recursive: true, force: true },
      );
      expect(mockRm).toHaveBeenCalledWith(
        'runs/20260409000000_run-000',
        { recursive: true, force: true },
      );
      expect(mockRm).toHaveBeenCalledTimes(2);
    });

    it('returns pruned run IDs', async () => {
      const store = new EvalStore('runs', 2);
      const index: RunIndex = {
        runs: [
          {
            runId: 'run-002',
            timestamp: '2026-04-09T02:00:00.000Z',
            dir: '20260409020000_run-002',
          },
          {
            runId: 'run-001',
            timestamp: '2026-04-09T01:00:00.000Z',
            dir: '20260409010000_run-001',
          },
          {
            runId: 'run-000',
            timestamp: '2026-04-09T00:00:00.000Z',
            dir: '20260409000000_run-000',
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));

      const pruned = await store.prune();

      expect(pruned).toEqual(['run-000']);
    });

    it('updates index to keep only newest maxRuns entries', async () => {
      const store = new EvalStore('runs', 2);
      const index: RunIndex = {
        runs: [
          {
            runId: 'run-002',
            timestamp: '2026-04-09T02:00:00.000Z',
            dir: '20260409020000_run-002',
          },
          {
            runId: 'run-001',
            timestamp: '2026-04-09T01:00:00.000Z',
            dir: '20260409010000_run-001',
          },
          {
            runId: 'run-000',
            timestamp: '2026-04-09T00:00:00.000Z',
            dir: '20260409000000_run-000',
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));

      await store.prune();

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      expect(tmpCall).toBeDefined();
      const parsed = JSON.parse(tmpCall![1] as string) as RunIndex;
      expect(parsed.runs).toHaveLength(2);
      expect(parsed.runs.map((r) => r.runId)).toEqual(
        ['run-002', 'run-001'],
      );
      expect(mockRename).toHaveBeenCalledWith(
        tmpCall![0],
        'runs/.run-index.json',
      );
    });

    it('returns empty array when index file is missing', async () => {
      const store = new EvalStore();

      const pruned = await store.prune();

      expect(pruned).toEqual([]);
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('returns empty array when maxRuns is 0 and index is missing',
      async () => {
        const store = new EvalStore('runs', 0);

        const pruned = await store.prune();

        expect(pruned).toEqual([]);
        expect(mockRm).not.toHaveBeenCalled();
      },
    );

    it('removes on-disk dirs not tracked in index', async () => {
      const store = new EvalStore('runs', 10);
      const index: RunIndex = {
        runs: [{
          runId: 'run-001',
          timestamp: '2026-04-09T01:00:00.000Z',
          dir: '20260409010000_run-001',
        }],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
      mockReaddir.mockResolvedValueOnce([
        '20260409010000_run-001',
        '20260408000000_orphan',
        '.run-index.json',
      ]);

      await store.prune();

      expect(mockRm).toHaveBeenCalledWith(
        'runs/20260408000000_orphan',
        { recursive: true, force: true },
      );
      expect(mockRm).not.toHaveBeenCalledWith(
        'runs/20260409010000_run-001',
        expect.anything(),
      );
      expect(mockRm).toHaveBeenCalledTimes(1);
    });

    it('skips dotfiles when scanning for orphans', async () => {
      const store = new EvalStore('runs', 10);
      const index: RunIndex = { runs: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
      mockReaddir.mockResolvedValueOnce([
        '.run-index.json',
        '.gitkeep',
      ]);

      await store.prune();

      expect(mockRm).not.toHaveBeenCalled();
    });

    it('handles ENOENT from readdir gracefully', async () => {
      const store = new EvalStore('runs', 10);
      const index: RunIndex = { runs: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
      mockReaddir.mockRejectedValueOnce(
        Object.assign(
          new Error('no such file or directory'),
          { code: 'ENOENT' },
        ),
      );

      const pruned = await store.prune();

      expect(pruned).toEqual([]);
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('cleans all indexed and orphan dirs when maxRuns is 0',
      async () => {
        const store = new EvalStore('runs', 0);
        const index: RunIndex = {
          runs: [
            {
              runId: 'run-001',
              timestamp: '2026-04-09T01:00:00.000Z',
              dir: '20260409010000_run-001',
            },
            {
              runId: 'run-000',
              timestamp: '2026-04-09T00:00:00.000Z',
              dir: '20260409000000_run-000',
            },
          ],
        };
        mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
        mockReaddir.mockResolvedValueOnce([
          '20260409010000_run-001',
          '20260409000000_run-000',
          '20260408000000_orphan',
        ]);

        await store.prune();

        expect(mockRm).toHaveBeenCalledWith(
          'runs/20260409010000_run-001',
          { recursive: true, force: true },
        );
        expect(mockRm).toHaveBeenCalledWith(
          'runs/20260409000000_run-000',
          { recursive: true, force: true },
        );
        expect(mockRm).toHaveBeenCalledWith(
          'runs/20260408000000_orphan',
          { recursive: true, force: true },
        );
        expect(mockRm).toHaveBeenCalledTimes(3);
      },
    );
  });

  describe('listRuns()', () => {
    it('returns runs newest-first from index', async () => {
      const store = new EvalStore();
      const index: RunIndex = {
        runs: [
          {
            runId: 'run-002',
            timestamp: '2026-04-09T02:00:00.000Z',
            dir: '20260409020000_run-002',
          },
          {
            runId: 'run-001',
            timestamp: '2026-04-09T01:00:00.000Z',
            dir: '20260409010000_run-001',
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));

      const runs = await store.listRuns();

      expect(runs).toEqual(index.runs);
    });

    it('returns empty array when index file is missing', async () => {
      const store = new EvalStore();

      const runs = await store.listRuns();

      expect(runs).toEqual([]);
    });
  });

  describe('initRun()', () => {
    it('creates the run directory', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();

      await store.initRun('run-001', [scenario], makeConfig());

      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001`,
        { recursive: true },
      );
    });

    it('writes run-metadata.json with scenario names', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const config = makeConfig();

      await store.initRun('run-001', [scenario], config);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.runId).toBe('run-001');
      expect(parsed.scenarios).toEqual(['test-scenario']);
      expect(parsed.config.gocode.apiKey).toBeUndefined();
      expect(parsed.config.gocode.baseUrl).toBe(
        config.gocode.baseUrl,
      );
      expect(parsed.config.gocode.model).toBe(config.gocode.model);
      expect(parsed.config.env).toBe(config.env);
      expect(parsed.config.aab).toEqual(config.aab);
      expect(parsed.config.eval).toEqual(config.eval);
      expect(parsed.maxTurns).toBe(config.eval.maxTurns);
      expect(parsed.trialsOverride).toBeUndefined();
    });

    it(
      'includes trialsOverride in run-metadata.json when provided',
      async () => {
        const store = new EvalStore();
        const scenario = makeScenario();

        await store.initRun(
          'run-001', [scenario], makeConfig(), { trialsOverride: 5 },
        );

        const call = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('run-metadata.json'),
        );
        const parsed = JSON.parse(call![1] as string);
        expect(parsed.trialsOverride).toBe(5);
      },
    );

    it(
      'creates scenario dir and writes scenario-config.json',
      async () => {
        const store = new EvalStore();
        const scenario = makeScenario();

        await store.initRun('run-001', [scenario], makeConfig());

        expect(mockMkdir).toHaveBeenCalledWith(
          `runs/${FIXED_COMPACT}_run-001/scenarios/test-scenario`,
          { recursive: true },
        );
        const call = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('scenario-config.json'),
        );
        expect(call).toBeDefined();
        const parsed = JSON.parse(call![1] as string);
        expect(parsed.name).toBe('test-scenario');
      },
    );

    it('returns dirName', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();

      const dirName = await store.initRun(
        'run-001', [scenario], makeConfig(),
      );

      expect(dirName).toBe(`${FIXED_COMPACT}_run-001`);
    });

    it('writes kind to run-metadata.json when provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();

      await store.initRun(
        'run-001', [scenario], makeConfig(), { kind: 'graduation' },
      );

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('run-metadata.json'),
      );
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.kind).toBe('graduation');
    });

    it('uses provided dirName instead of generating one', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();

      const result = await store.initRun(
        'run-001', [scenario], makeConfig(), { dirName: 'my-fixed-dir' },
      );

      expect(result).toBe('my-fixed-dir');
      expect(mockMkdir).toHaveBeenCalledWith(
        'runs/my-fixed-dir',
        { recursive: true },
      );
    });
  });

  describe('writeTrial() — public direct call', () => {
    const DIR_NAME = `${FIXED_COMPACT}_run-001`;

    it('writes transcript.json for the trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('transcript.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.scenarioName).toBe('test-scenario');
      expect(parsed.trialIndex).toBe(0);
    });

    it('writes eval-results.json for the trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0, [], [0.9]);

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(
        call![1] as string,
      ) as EvalResult[];
      expect(parsed[0].score).toBe(0.9);
    });

    it('writes eval-results.md for the trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0, [], [0.9]);

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.md'),
      );
      expect(call).toBeDefined();
      expect(call![1]).toBe('## mock eval results\n');
      expect(
        (call![0] as string).includes('trials/0'),
      ).toBe(true);
      expect(mockRenderTrialEvalResultsMarkdown).toHaveBeenCalledWith(trial);
    });

    it('writes tool_calls.json for the trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('tool_calls.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(
        call![1] as string,
      ) as StoredToolCallSummary;
      expect(parsed).toHaveProperty('totalCount');
    });

    it('writes conversation.json for the trial', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('conversation.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed).toHaveProperty('scenarioName');
      expect(parsed).toHaveProperty('turns');
      expect(parsed).toHaveProperty('summary');
      expect(
        (call![0] as string).includes('trials/0'),
      ).toBe(true);
      expect(mockRenderConversation).toHaveBeenCalledWith(
        trial.transcript.turns,
        trial.transcript.scenarioName,
        trial.transcript.trialIndex,
      );
    });

    it(
      're-throws but does not delete trial dir when a write fails',
      async () => {
        const store = new EvalStore();
        const trial = makeTrialResult(0);
        const writeError = new Error('disk full');
        mockWriteFile
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(writeError);

        await expect(
          store.writeTrial(DIR_NAME, 'test-scenario', trial),
        ).rejects.toThrow('disk full');

        const trialDirRm = mockRm.mock.calls.find(([p]) =>
          (p as string).endsWith('trials/0'),
        );
        expect(trialDirRm).toBeUndefined();
      },
    );

    it('logs write error to stderr without cleanup', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);
      const writeError = new Error('disk full');
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(function () {});
      mockWriteFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(writeError);

      await expect(
        store.writeTrial(DIR_NAME, 'test-scenario', trial),
      ).rejects.toThrow('disk full');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('write failed'),
        expect.objectContaining({ trialDir: expect.any(String) }),
        writeError,
      );
      consoleErrorSpy.mockRestore();
    });

    it(
      're-throws but does not delete trial dir when ' +
        'renderConversation throws',
      async () => {
        const store = new EvalStore();
        const trial = makeTrialResult(0);
        const renderError = new Error('render failed');
        mockRenderConversation.mockImplementationOnce(function () {
          throw renderError;
        });

        await expect(
          store.writeTrial(DIR_NAME, 'test-scenario', trial),
        ).rejects.toThrow('render failed');

        expect(mockWriteFile).not.toHaveBeenCalled();
        const trialDirRm = mockRm.mock.calls.find(([p]) =>
          (p as string).endsWith('trials/0'),
        );
        expect(trialDirRm).toBeUndefined();
      },
    );

    it(
      'writes meta.json and console-logs.json for snapshots ' +
        '(but not png/html)',
      async () => {
        const store = new EvalStore();
        const trial = makeTrialResult(0, [makeDOMSnapshot(0)]);

        await store.writeTrial(DIR_NAME, 'test-scenario', trial);

        expect(mockMkdir).toHaveBeenCalledWith(
          expect.stringContaining('trials/0/snapshots'),
          { recursive: true },
        );
        const metaCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.meta.json'),
        );
        const consoleCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.console-logs.json'),
        );
        expect(metaCall).toBeDefined();
        expect(consoleCall).toBeDefined();
        const pngCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.png'),
        );
        const htmlCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('0.html'),
        );
        expect(pngCall).toBeUndefined();
        expect(htmlCall).toBeUndefined();
      },
    );

    it(
      'writes snapshots/capture.json when capturedSite present',
      async () => {
        const store = new EvalStore();
        const capturedSite: CapturedSite = {
          previewUrl: 'https://example.com',
          generatedAt: '2026-04-09T00:00:00.000Z',
          durationMs: 1234,
          outputDir:
            `runs/${DIR_NAME}/scenarios/test-scenario` +
            '/trials/0/snapshots',
          routes: [],
          perRoute: [],
          errors: [],
        };
        const trial = makeTrialResult(0);
        trial.transcript.capturedSite = capturedSite;

        await store.writeTrial(DIR_NAME, 'test-scenario', trial);

        const captureCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('snapshots/capture.json'),
        );
        expect(captureCall).toBeDefined();
        const parsed = JSON.parse(captureCall![1] as string);
        expect(parsed.previewUrl).toBe('https://example.com');
        expect(parsed.durationMs).toBe(1234);
      },
    );

    it(
      'omits capture.json write when capturedSite is absent',
      async () => {
        const store = new EvalStore();
        const trial = makeTrialResult(0);

        await store.writeTrial(DIR_NAME, 'test-scenario', trial);

        const captureCall = mockWriteFile.mock.calls.find(([p]) =>
          (p as string).endsWith('capture.json'),
        );
        expect(captureCall).toBeUndefined();
      },
    );
  });

  describe('finalizeRun()', () => {
    const DIR_NAME = `${FIXED_COMPACT}_run-001`;

    it('writes aggregated.json for each scenario result', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.finalizeRun(DIR_NAME, 'run-001', [result]);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregated.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string);
      expect(parsed.scenarioName).toBe('test-scenario');
    });

    it('writes aggregate-report.md using MdReporter.render()', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [
        makeScenarioResult(scenario, [makeTrialResult()]),
      ];

      await store.finalizeRun(DIR_NAME, 'run-001', results);

      expect(mockRender).toHaveBeenCalledWith('run-001', results, { runMode: 'eval' });
      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregate-report.md'),
      );
      expect(call).toBeDefined();
      expect(call![1]).toBe('# mock summary');
    });

    it('updates .run-index.json', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.finalizeRun(DIR_NAME, 'run-001', [result]);

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      expect(tmpCall).toBeDefined();
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs[0].runId).toBe('run-001');
      expect(parsed.runs[0].dir).toBe(DIR_NAME);
    });

    it('returns runDir', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      const runDir = await store.finalizeRun(
        DIR_NAME, 'run-001', [result],
      );

      expect(runDir).toBe(`runs/${DIR_NAME}`);
    });

    it('writes kind to run-index entry when provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const result = makeScenarioResult(
        scenario, [makeTrialResult()],
      );

      await store.finalizeRun(
        DIR_NAME, 'run-001', [result], 'graduation',
      );

      const tmpCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).includes('.run-index.json') &&
        (p as string).endsWith('.tmp'),
      );
      const parsed = JSON.parse(tmpCall![1] as string);
      expect(parsed.runs[0].kind).toBe('graduation');
    });

    it('passes gitSha and gitBranch from metadata to MdReporter.render()', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      const metadata: RunMetadata = {
        runId: 'run-001',
        timestamp: '2026-04-09T00:00:00.000Z',
        gitSha: 'abc123def456abc1',
        gitBranch: 'main',
        scenarios: ['test-scenario'],
        config: makeConfig(),
        maxTurns: makeConfig().eval.maxTurns,
      };
      // finalizeRun order: metadata read then index read (updateRunIndex)
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(metadata)); // metadata (index falls through to default ENOENT)

      await store.finalizeRun(DIR_NAME, 'run-001', results);

      expect(mockRender).toHaveBeenCalledWith(
        'run-001',
        results,
        expect.objectContaining({ gitSha: 'abc123def456abc1', gitBranch: 'main' }),
      );
    });

    it('does not set git fields in render options when metadata is missing', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      // Both readFile calls (index and metadata) use default ENOENT mock

      await store.finalizeRun(DIR_NAME, 'run-001', results);

      const renderCall = mockRender.mock.calls[0][2] as Record<string, unknown>;
      expect(renderCall).not.toHaveProperty('gitSha');
      expect(renderCall).not.toHaveProperty('gitBranch');
    });

    it('does not set null git fields in render options when metadata has null values', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      const metadata: RunMetadata = {
        runId: 'run-001',
        timestamp: '2026-04-09T00:00:00.000Z',
        gitSha: null,
        gitBranch: null,
        scenarios: ['test-scenario'],
        config: makeConfig(),
        maxTurns: makeConfig().eval.maxTurns,
      };
      // finalizeRun order: metadata read then index read (updateRunIndex)
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(metadata)); // metadata (index falls through to default ENOENT)

      await store.finalizeRun(DIR_NAME, 'run-001', results);

      const renderCall = mockRender.mock.calls[0][2] as Record<string, unknown>;
      expect(renderCall).not.toHaveProperty('gitSha');
      expect(renderCall).not.toHaveProperty('gitBranch');
    });

    it('writes summary.md via NarrativeSummaryReporter when gocode is provided', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      const mockGocode = { complete: vi.fn() } as unknown as IGocodeClient;

      await store.finalizeRun(DIR_NAME, 'run-001', results, undefined, undefined, mockGocode);

      expect(mockNarrativeRender).toHaveBeenCalledWith(
        'run-001',
        results,
        expect.objectContaining({ runMode: 'eval' }),
      );
      const summaryCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('summary.md'),
      );
      expect(summaryCall).toBeDefined();
      expect(summaryCall![1]).toBe('# narrative summary');
    });

    it('writes no-client stub to summary.md when gocode is absent', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];

      await store.finalizeRun(DIR_NAME, 'run-001', results);

      expect(mockNarrativeRender).not.toHaveBeenCalled();
      const summaryCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('summary.md'),
      );
      expect(summaryCall).toBeDefined();
      expect(summaryCall![1] as string).toContain('aggregate-report.md');
    });

    it('writes fallback stub and does not throw when NarrativeSummaryReporter.render() throws', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      const mockGocode = { complete: vi.fn() } as unknown as IGocodeClient;
      mockNarrativeRender.mockRejectedValueOnce(new Error('LLM error'));

      await expect(
        store.finalizeRun(DIR_NAME, 'run-001', results, undefined, undefined, mockGocode),
      ).resolves.toBeDefined();

      const aggregateCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('aggregate-report.md'),
      );
      expect(aggregateCall).toBeDefined();

      const summaryCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('summary.md'),
      );
      expect(summaryCall).toBeDefined();
      expect(summaryCall![1] as string).toContain('aggregate-report.md');
    });

    it('passes tostConfig from renderOptions through to MdReporter.render()', async () => {
      const store = new EvalStore();
      const scenario = makeScenario();
      const results = [makeScenarioResult(scenario, [makeTrialResult()])];
      const tostConfig = { alpha: 0.05, k: 2.0 };

      await store.finalizeRun(DIR_NAME, 'run-001', results, undefined, { tostConfig });

      expect(mockRender).toHaveBeenCalledWith(
        'run-001',
        results,
        expect.objectContaining({ tostConfig }),
      );
    });
  });

  describe('acquireRunLock()', () => {
    it('throws when the run lock is already held', async () => {
      const store = new EvalStore();
      mockMkdir.mockRejectedValueOnce(
        Object.assign(new Error('exists'), { code: 'EEXIST' }),
      );
      // owner.json indicates a live process (current PID, recent timestamp)
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );

      await expect(
        store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
      ).rejects.toThrow('Cannot acquire run');
    });

    it('removes the lock directory on release', async () => {
      const store = new EvalStore();
      const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);

      await release();

      expect(mockMkdir).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/.run.lock`,
        { recursive: false },
      );
      expect(mockRm).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/.run.lock`,
        { recursive: true },
      );
    });

    it('removes the lock directory when owner write fails', async function ownerWriteFailure() {
      const store = new EvalStore();
      const writeError = new Error('owner write failed');
      mockWriteFile.mockRejectedValueOnce(writeError);

      await expect(
        store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
      ).rejects.toThrow('owner write failed');

      expect(mockRm).toHaveBeenCalledWith(
        `runs/${FIXED_COMPACT}_run-001/.run.lock`,
        { recursive: true },
      );
    });

    it('logs and throws when lock release fails', async function releaseFailure() {
      const store = new EvalStore();
      const rmError = Object.assign(new Error('permission denied'), {
        code: 'EPERM',
      });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(function error() {});
      const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
      mockRm.mockRejectedValueOnce(rmError);

      await expect(release()).rejects.toThrow('permission denied');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to release gosym-probe lock.',
        {
          label: `run ${FIXED_COMPACT}_run-001`,
          lockDir: `runs/${FIXED_COMPACT}_run-001/.run.lock`,
        },
        rmError,
      );
      consoleErrorSpy.mockRestore();
    });

    describe('stale-PID detection', () => {
      const originalKill = process.kill;
      let mockKill: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        mockKill = vi.fn().mockReturnValue(true);
        process.kill = mockKill as unknown as typeof process.kill;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
      });

      afterEach(() => {
        process.kill = originalKill;
        vi.restoreAllMocks();
      });

      it('removes stale lock when owner PID is dead and retries successfully', async () => {
        const store = new EvalStore();
        // First mkdir: EEXIST (lock exists)
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        // readFile returns dead PID's owner.json
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 99999, createdAt: '2026-01-01T00:00:00Z' }),
        );
        // process.kill throws ESRCH (process not found)
        mockKill.mockImplementation(() => {
          throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
        });
        // rm succeeds (stale lock removed)
        mockRm.mockResolvedValueOnce(undefined);
        // Retry mkdir succeeds
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);

        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Removing stale'),
        );
        expect(mockRm).toHaveBeenCalled();
        expect(typeof release).toBe('function');
      });

      it('throws when owner PID is alive', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
        );
        // process.kill returns without error (process is alive)
        mockKill.mockImplementation(() => true);

        await expect(
          store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
        ).rejects.toThrow('Cannot acquire run');
      });

      it('treats EPERM on kill as alive (process exists, no permission)', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 1, createdAt: new Date().toISOString() }),
        );
        mockKill.mockImplementation(() => {
          throw Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
        });

        await expect(
          store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
        ).rejects.toThrow('Cannot acquire run');
      });

      it('treats missing owner.json as stale', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        // readFile throws ENOENT
        mockReadFile.mockRejectedValueOnce(
          Object.assign(new Error('not found'), { code: 'ENOENT' }),
        );
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        expect(typeof release).toBe('function');
      });

      it('treats malformed owner.json as stale', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce('not valid json {{{');
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        expect(typeof release).toBe('function');
      });

      it('treats owner.json with non-numeric pid as stale', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 'not-a-number', createdAt: '2026-01-01T00:00:00Z' }),
        );
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        expect(typeof release).toBe('function');
      });

      it('treats owner.json with pid <= 0 as stale', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 0, createdAt: '2026-01-01T00:00:00Z' }),
        );
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        expect(typeof release).toBe('function');
      });

      it('treats unexpected kill error as alive (conservative)', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 12345, createdAt: new Date().toISOString() }),
        );
        mockKill.mockImplementation(() => {
          throw Object.assign(new Error('unexpected'), { code: 'EINVAL' });
        });

        await expect(
          store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
        ).rejects.toThrow('Cannot acquire run');
      });

      it('treats transient I/O error on owner.json as live (not stale)', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        // readFile throws EACCES (permission denied) — transient, not stale
        mockReadFile.mockRejectedValueOnce(
          Object.assign(new Error('permission denied'), { code: 'EACCES' }),
        );

        await expect(
          store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
        ).rejects.toThrow('Cannot acquire run');
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('cannot read owner.json'),
          expect.objectContaining({ code: 'EACCES' }),
        );
      });

      it('treats lock exceeding max age as stale regardless of PID liveness', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        // owner.json with a live PID but old createdAt (>2h ago)
        const oldTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: process.pid, createdAt: oldTimestamp }),
        );
        // process.kill would indicate alive, but max-age should short-circuit
        mockKill.mockImplementation(() => true);
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        expect(typeof release).toBe('function');
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('lock exceeds max age'),
          expect.objectContaining({ pid: process.pid }),
        );
      });

      it('throws descriptive error on race condition (retry mkdir EEXIST)', async () => {
        const store = new EvalStore();
        // First mkdir: EEXIST
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 99999, createdAt: '2026-01-01T00:00:00Z' }),
        );
        mockKill.mockImplementation(() => {
          throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
        });
        mockRm.mockResolvedValueOnce(undefined);
        // Retry mkdir also EEXIST (another process won the race)
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );

        await expect(
          store.acquireRunLock(`${FIXED_COMPACT}_run-001`),
        ).rejects.toThrow('race condition');
      });

      it('returned release() works after stale lock recovery', async () => {
        const store = new EvalStore();
        mockMkdir.mockRejectedValueOnce(
          Object.assign(new Error('exists'), { code: 'EEXIST' }),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ pid: 99999, createdAt: '2026-01-01T00:00:00Z' }),
        );
        mockKill.mockImplementation(() => {
          throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
        });
        mockRm.mockResolvedValueOnce(undefined);
        mockMkdir.mockResolvedValueOnce(undefined);

        const release = await store.acquireRunLock(`${FIXED_COMPACT}_run-001`);
        mockRm.mockResolvedValueOnce(undefined);
        await release();

        // rm called twice: once for stale removal, once for release
        expect(mockRm).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('writePartialTrial()', () => {
    const DIR_NAME = `${FIXED_COMPACT}_run-001`;

    it('writes transcript.json with snapshotCount 0 and empty errors', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('transcript.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![1] as string) as StoredTranscript;
      expect(parsed.scenarioName).toBe('test-scenario');
      expect(parsed.trialIndex).toBe(0);
      expect(parsed.turns).toHaveLength(2);
      expect(parsed.snapshotCount).toBe(0);
      expect(parsed.errors).toEqual([]);
    });

    it('writes conversation.json via renderConversation', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('conversation.json'),
      );
      expect(call).toBeDefined();
      expect(mockRenderConversation).toHaveBeenCalledWith(
        transcript.turns,
        transcript.scenarioName,
        transcript.trialIndex,
      );
    });

    it('writes tool_calls.json via summarizeToolCalls', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('tool_calls.json'),
      );
      expect(call).toBeDefined();
      const parsed = JSON.parse(
        call![1] as string,
      ) as StoredToolCallSummary;
      expect(parsed).toHaveProperty('sequence');
      expect(parsed).toHaveProperty('totalCount');
    });

    it('writes artifacts when extractable tool calls exist', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResultWithReadFile(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('trials/0/artifacts'),
        { recursive: true },
      );
      const artifactCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('0-Header.tsx'),
      );
      expect(artifactCall).toBeDefined();
      const manifestCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('artifacts/artifacts.json'),
      );
      expect(manifestCall).toBeDefined();
    });

    it('does NOT write eval-results.json', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.json'),
      );
      expect(call).toBeUndefined();
    });

    it('does NOT write eval-results.md', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const call = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.md'),
      );
      expect(call).toBeUndefined();
    });

    it('does NOT write snapshot metadata', async () => {
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const metaCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('.meta.json'),
      );
      const consoleLogsCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('.console-logs.json'),
      );
      expect(metaCall).toBeUndefined();
      expect(consoleLogsCall).toBeUndefined();
    });

    it('handles empty transcript (0 turns) producing valid JSON', async () => {
      const store = new EvalStore();
      const transcript = {
        scenarioName: 'test-scenario',
        trialIndex: 0,
        turns: [],
        snapshots: [],
        errors: [],
        captureErrors: [],
        
      };

      await store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript);

      const transcriptCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('transcript.json'),
      );
      expect(transcriptCall).toBeDefined();
      const parsed = JSON.parse(transcriptCall![1] as string);
      expect(parsed.turns).toEqual([]);
      expect(parsed.snapshotCount).toBe(0);

      const toolCallsCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('tool_calls.json'),
      );
      expect(toolCallsCall).toBeDefined();
      const toolCalls = JSON.parse(toolCallsCall![1] as string);
      expect(toolCalls.totalCount).toBe(0);
      expect(toolCalls.sequence).toEqual([]);
    });

    it('subsequent writeTrial overwrites partial data cleanly', async () => {
      const store = new EvalStore();
      const trial = makeTrialResult(0);

      await store.writePartialTrial(
        DIR_NAME, 'test-scenario', 0, trial.transcript,
      );

      vi.clearAllMocks();
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRenderTrialEvalResultsMarkdown.mockReturnValue(
        '## mock eval results\n',
      );
      mockRenderConversation.mockReturnValue({
        scenarioName: 'test-scenario',
        trial: 1,
        turns: [{ role: 'user', content: 'hello', durationSeconds: 0 }],
        summary: { messageCount: 1, totalElapsedSeconds: 0 },
      });

      await store.writeTrial(DIR_NAME, 'test-scenario', trial);

      const transcriptCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('transcript.json'),
      );
      expect(transcriptCall).toBeDefined();

      const evalResultsCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.json'),
      );
      expect(evalResultsCall).toBeDefined();

      const evalMdCall = mockWriteFile.mock.calls.find(([p]) =>
        (p as string).endsWith('eval-results.md'),
      );
      expect(evalMdCall).toBeDefined();
    });

    it('logs console.error and rejects on I/O failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});
      const store = new EvalStore();
      const transcript = makeTrialResult(0).transcript;
      const ioError = new Error('ENOSPC: no space left on device');

      mockWriteFile.mockRejectedValueOnce(ioError);

      await expect(
        store.writePartialTrial(DIR_NAME, 'test-scenario', 0, transcript),
      ).rejects.toThrow('ENOSPC: no space left on device');

      expect(errorSpy).toHaveBeenCalledWith(
        'writePartialTrial: write failed',
        expect.objectContaining({
          scenarioName: 'test-scenario',
          trialIndex: 0,
        }),
        ioError,
      );

      errorSpy.mockRestore();
    });
  });

  describe('load methods', () => {
    // Helper: seed the index so findRunDir can resolve run-001
    function seedIndex(): void {
      const index: RunIndex = {
        runs: [{
          runId: 'run-001',
          timestamp: '2026-04-09T00:00:00.000Z',
          dir: '20260409000000_run-001',
        }],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
    }

    describe('loadRunMetadata()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const metadata: RunMetadata = {
          runId: 'run-001',
          timestamp: '2026-04-09T00:00:00.000Z',
          gitSha: 'abc123',
          scenarios: ['test-scenario'],
          config: makeConfig(),
          maxTurns: makeConfig().eval.maxTurns,
        };
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(metadata));

        const result = await store.loadRunMetadata('run-001');

        expect(result).toEqual(metadata);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/run-metadata.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        // index returns empty
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadRunMetadata('run-001');

        expect(result).toBeNull();
      });

      it('returns null on ENOENT for metadata file', async () => {
        const store = new EvalStore();
        seedIndex();
        // metadata file not found
        mockReadFile.mockRejectedValueOnce(
          Object.assign(new Error('not found'), { code: 'ENOENT' }),
        );

        const result = await store.loadRunMetadata('run-001');

        expect(result).toBeNull();
      });

      it('re-throws non-ENOENT errors', async () => {
        const store = new EvalStore();
        seedIndex();
        mockReadFile.mockRejectedValueOnce(
          new Error('permission denied'),
        );

        await expect(
          store.loadRunMetadata('run-001'),
        ).rejects.toThrow('permission denied');
      });
    });

    describe('loadTranscript()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const transcript: StoredTranscript = {
          scenarioName: 'test-scenario',
          trialIndex: 0,
          turns: [],
          snapshotCount: 2,
          errors: [],
        };
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(transcript));

        const result = await store.loadTranscript(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toEqual(transcript);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/scenarios/test-scenario' +
            '/trials/0/transcript.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadTranscript(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toBeNull();
      });
    });

    describe('loadTrialResultByDirName()', () => {
      it('defaults captureErrors to [] when field is missing from stored transcript', async () => {
        const store = new EvalStore();
        const transcriptWithoutCaptureErrors = {
          scenarioName: 'test-scenario',
          trialIndex: 0,
          turns: [],
          snapshotCount: 1,
          errors: [],
          // captureErrors intentionally omitted to simulate pre-existing data
        };
        const evalResults: EvalResult[] = [
          {
            evaluator: 'test-evaluator',
            score: 1.0,
            verdict: 'pass',
            reason: 'all good',
          },
        ];
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify(transcriptWithoutCaptureErrors),
        );
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify(evalResults),
        );

        const result = await store.loadTrialResultByDirName(
          '20260409000000_run-001', 'test-scenario', 0,
        );

        expect(result).not.toBeNull();
        expect(result!.transcript.captureErrors).toEqual([]);
      });
    });

    describe('loadEvalResults()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const evalResults: EvalResult[] = [
          {
            evaluator: 'test-evaluator',
            score: 0.9,
            verdict: 'pass',
            reason: 'passed',
          },
        ];
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(evalResults));

        const result = await store.loadEvalResults(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toEqual(evalResults);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/scenarios/test-scenario' +
            '/trials/0/eval-results.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadEvalResults(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toBeNull();
      });
    });

    describe('loadAggregated()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const aggregated: StoredAggregated = {
          scenarioName: 'test-scenario',
          evaluators: {
            'test-evaluator': {
              passAtK: true,
              passToTheK: true,
              passingTrials: 1,
              totalTrials: 1,
              scores: {
                min: 0.8,
                max: 0.8,
                mean: 0.8,
                median: 0.8,
                stddev: 0,
              },
              verdicts: { pass: 1 },
            },
          },
          timing: {
            totalDurationMs: 2000,
            avgTrialDurationMs: 2000,
            avgTurnsPerTrial: 2,
          },
        };
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(aggregated));

        const result = await store.loadAggregated(
          'run-001', 'test-scenario',
        );

        expect(result).toEqual(aggregated);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/scenarios/test-scenario' +
            '/aggregated.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadAggregated(
          'run-001', 'test-scenario',
        );

        expect(result).toBeNull();
      });
    });

    describe('loadToolCallSummary()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const summary: StoredToolCallSummary = {
          sequence: [
            {
              index: 0,
              turnIndex: 1,
              name: 'readFile',
              hasError: false,
              startTime: 1000,
              endTime: 1100,
            },
          ],
          totalCount: 1,
          uniqueTools: ['readFile'],
          uniqueCount: 1,
          countByTool: { readFile: 1 },
        };
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(summary));

        const result = await store.loadToolCallSummary(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toEqual(summary);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/scenarios/test-scenario' +
            '/trials/0/tool_calls.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadToolCallSummary(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toBeNull();
      });
    });

    describe('loadArtifactManifest()', () => {
      it('returns parsed data when file exists', async () => {
        const store = new EvalStore();
        const manifest: StoredArtifactManifest = {
          artifacts: [
            {
              index: 0,
              turnIndex: 0,
              toolName: 'readFile',
              filename: '0-Header.tsx',
            },
          ],
          totalCount: 1,
        };
        seedIndex();
        mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));

        const result = await store.loadArtifactManifest(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toEqual(manifest);
        expect(mockReadFile).toHaveBeenCalledWith(
          'runs/20260409000000_run-001/scenarios/test-scenario' +
            '/trials/0/artifacts/artifacts.json',
          'utf-8',
        );
      });

      it('returns null when runId not in index', async () => {
        const store = new EvalStore();
        mockReadFile.mockResolvedValueOnce(
          JSON.stringify({ runs: [] }),
        );

        const result = await store.loadArtifactManifest(
          'run-001', 'test-scenario', 0,
        );

        expect(result).toBeNull();
      });
    });
  });
});
