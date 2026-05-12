import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { GocodeClient } from '../../clients/gocode-client.js';
import type { Persona } from '../../personas/types.js';
import type {
  DOMSnapshot,
  Transcript,
} from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import { OutputQualityEvaluator } from '../output-quality.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

let tmpRoot: string;

async function writeSnapshotHtml(
  html: string,
  name = 'snap.html',
): Promise<string> {
  const path = join(tmpRoot, name);
  await writeFile(path, html);
  return path;
}

async function makeSnapshot(
  html = '<body><h1>Hello</h1></body>',
  name?: string,
): Promise<DOMSnapshot> {
  const htmlPath = await writeSnapshotHtml(html, name);
  return {
    url: 'https://localhost:8443',
    htmlPath,
    screenshotPath: '/tmp/never-read.png',
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    category: 'regression',
    ...overrides,
  };
}

describe('OutputQualityEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: OutputQualityEvaluator;

  beforeEach(async () => {
    mockGocode = { complete: vi.fn() };
    evaluator = new OutputQualityEvaluator(
      mockGocode as unknown as GocodeClient,
    );
    tmpRoot = await mkdtemp(join(tmpdir(), 'output-quality-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns unknown without calling GoCode when no snapshot', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('returns unknown without calling GoCode for empty snapshot HTML', async () => {
    const snap = await makeSnapshot('', 'empty.html');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
      snap,
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('returns unknown for whitespace-only snapshot HTML', async () => {
    const snap = await makeSnapshot('   \n  ', 'ws.html');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
      snap,
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it(
    'returns unknown when html file cannot be read',
    async () => {
      const snap: DOMSnapshot = {
        url: 'https://localhost:8443',
        htmlPath: join(tmpRoot, 'does-not-exist.html'),
        screenshotPath: join(tmpRoot, 'no.png'),
        timestamp: new Date().toISOString(),
        consoleLogs: [],
      };
      const result = await evaluator.evaluate(
        makeTranscript(),
        makeScenario(),
        snap,
      );
      expect(result.verdict).toBe('unknown');
      expect(result.reason).toContain('Failed to read snapshot html');
      expect(mockGocode.complete).not.toHaveBeenCalled();
    },
  );

  it('parses SCORE, VERDICT and REASON from LLM response', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.8\nVERDICT: pass\nREASON: Good output',
    );
    const snap = await makeSnapshot();
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build a page', assertion: 'positive' }],
      }),
      snap,
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('Good output');
  });

  it('clamps score to 1.0 when LLM returns score > 1', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 1.5\nVERDICT: pass\nREASON: test',
    );
    const snap = await makeSnapshot();
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      snap,
    );
    expect(result.score).toBe(1.0);
  });

  it('clamps score to 0.0 when LLM returns score < 0', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: -0.5\nVERDICT: fail\nREASON: test',
    );
    const snap = await makeSnapshot();
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      snap,
    );
    expect(result.score).toBe(0.0);
  });

  it('returns unknown on unparseable LLM response', async () => {
    mockGocode.complete.mockResolvedValue('I cannot tell.');
    const snap = await makeSnapshot();
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      snap,
    );
    expect(result.verdict).toBe('unknown');
  });

  it('extracts body content from full HTML page in prompt', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: ok',
    );
    const snap = await makeSnapshot(
      '<html><body><h1>Hello World</h1></body></html>',
    );
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      snap,
    );
    const userMessage =
      mockGocode.complete.mock.calls[0][0][1].content as string;
    expect(userMessage).toContain('Hello World');
  });

  it('includes Reference DOM section when referenceSolution is a DOMSnapshot', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: Matches reference',
    );
    const refSnapshot = await makeSnapshot(
      '<body><h1>Reference</h1></body>',
      'ref.html',
    );
    const snap = await makeSnapshot();
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: refSnapshot,
      }),
      snap,
    );
    const userMessage =
      mockGocode.complete.mock.calls[0][0][1].content as string;
    expect(userMessage).toContain('Reference DOM');
    expect(userMessage).toContain('Reference');
  });

  it('does not include Reference DOM when referenceSolution is a string', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: ok',
    );
    const snap = await makeSnapshot();
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: 'some string ref',
      }),
      snap,
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).not.toContain('Reference DOM');
  });

  it('reports evaluator name correctly', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.8\nVERDICT: pass\nREASON: ok',
    );
    const snap = await makeSnapshot();
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      snap,
    );
    expect(result.evaluator).toBe('output-quality');
  });

  it('is named output-quality', () => {
    expect(evaluator.name).toBe('output-quality');
  });
});
