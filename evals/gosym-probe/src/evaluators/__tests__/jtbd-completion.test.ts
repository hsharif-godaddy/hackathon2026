import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JTBDCompletionEvaluator } from '../jtbd-completion.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { Transcript, DOMSnapshot } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
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
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DOMSnapshot> = {}): DOMSnapshot {
  return {
    url: 'http://test',
    screenshotPath: '/tmp/snap.png',
    htmlPath: '/tmp/snap.html',
    timestamp: '2026-01-01T00:00:00.000Z',
    consoleLogs: [],
    ...overrides,
  };
}

describe('JTBDCompletionEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: JTBDCompletionEvaluator;

  beforeEach(() => {
    vi.resetAllMocks();
    mockGocode = { complete: vi.fn() };
    evaluator = new JTBDCompletionEvaluator(
      mockGocode as unknown as GocodeClient,
    );
  });

  it('returns unknown without calling GoCode when no goals defined', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ goals: [] }),
    );
    expect(result.verdict).toBe('incomplete');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('maps "pass" response to pass verdict and score 1.0', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build a page', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('maps "partial" response to fail verdict and score 0.0 (compat mapping)', async () => {
    mockGocode.complete.mockResolvedValue('partial');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.0);
  });

  it('maps "fail" response to fail verdict and score 0.0', async () => {
    mockGocode.complete.mockResolvedValue('fail');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.0);
  });

  it('maps "unknown" response to unknown verdict', async () => {
    mockGocode.complete.mockResolvedValue('unknown');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('maps "incomplete" response to incomplete verdict and score 0', async () => {
    mockGocode.complete.mockResolvedValue(
      'incomplete: insufficient information in transcript',
    );
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('defaults to unknown on unrecognized LLM response', async () => {
    mockGocode.complete.mockResolvedValue('I cannot determine the outcome.');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('includes "Did the agent accomplish" for positive goals', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{
          description: 'add a hero section',
          assertion: 'positive',
        }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Did the agent accomplish');
    expect(prompt).toContain('add a hero section');
  });

  it('includes "Did the agent correctly avoid" for negative goals', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{
          description: 'delete existing content',
          assertion: 'negative',
        }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Did the agent correctly avoid');
    expect(prompt).toContain('delete existing content');
  });

  it('includes string reference solution in prompt', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: 'The correct answer is XYZ',
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('The correct answer is XYZ');
  });

  it('includes transcript turn content in prompt', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const turns = [{
      role: 'user' as const,
      content: 'build me a landing page',
      toolCalls: [],
      timestamp: 0,
    }];
    await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('build me a landing page');
  });

  it('reports evaluator name correctly', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.evaluator).toBe('jtbd-completion');
  });

  it('is named jtbd-completion', () => {
    expect(evaluator.name).toBe('jtbd-completion');
  });

  describe('DOM snapshot HTML context', () => {
    const scenario = {
      name: 'test-scenario',
      persona: mockPersona,
      goals: [{ description: 'build a page', assertion: 'positive' as const }],
      evaluators: [],
      trials: 1,
    };

    it('includes inline body html from snapshot in LLM prompt', async () => {
      mockGocode.complete.mockResolvedValue('pass');
      const snapshot = makeSnapshot({ html: '<html><body>hello</body></html>' });
      const result = await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('Preview body HTML (sanitized):');
      expect(prompt).not.toContain('truncated to');
      expect(prompt).toContain('hello');
      expect(prompt).not.toContain('<html>');
      expect(result.details?.htmlContextAvailable).toBe(true);
    });

    it('reads htmlPath from disk when inline html is absent', async () => {
      vi.mocked(readFile).mockResolvedValue(
        '<html><body>from-file</body></html>' as string,
      );
      mockGocode.complete.mockResolvedValue('pass');
      const snapshot = makeSnapshot({ htmlPath: '/tmp/page.html' });
      const result = await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith('/tmp/page.html', 'utf-8');
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('Preview body HTML (sanitized):');
      expect(prompt).not.toContain('truncated to');
      expect(prompt).toContain('from-file');
      expect(prompt).not.toContain('<html>');
      expect(result.details?.htmlContextAvailable).toBe(true);
    });

    it('includes body content when head exceeds prompt budget', async () => {
      mockGocode.complete.mockResolvedValue('pass');
      const head = '<head>' + 'h'.repeat(10_000) + '</head>';
      const body = '<body><main>visible goal content</main></body>';
      const snapshot = makeSnapshot({ html: `<html>${head}${body}</html>` });
      await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('visible goal content');
      expect(prompt).not.toContain('h'.repeat(100));
    });

    it('strips presentational attributes from body HTML without truncation', async () => {
      mockGocode.complete.mockResolvedValue('pass');
      const html = '<html><body class="bg-white" style="margin:0"><p class="text-lg">Real content</p></body></html>';
      const snapshot = makeSnapshot({ html });
      await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('Preview body HTML (sanitized):');
      expect(prompt).toContain('Real content');
      expect(prompt).not.toContain('class=');
      expect(prompt).not.toContain('style=');
      expect(prompt).not.toContain('... [truncated]');
    });

    it('strips SVG elements from body HTML in prompt', async () => {
      mockGocode.complete.mockResolvedValue('pass');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100"/></svg>';
      const snapshot = makeSnapshot({
        html: `<html><body><main>${svg}<p>Real content</p></main></body></html>`,
      });
      await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('Real content');
      expect(prompt).not.toContain('<svg');
      expect(prompt).not.toContain('<rect');
    });

    it('omits HTML section when snapshot is undefined', async () => {
      mockGocode.complete.mockResolvedValue('pass');
      const result = await evaluator.evaluate(makeTranscript(), scenario, undefined);
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).not.toContain('Preview body HTML');
      expect(result.details?.htmlContextAvailable).toBe(false);
    });

    it('omits HTML section and does not throw when fs.readFile rejects', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      mockGocode.complete.mockResolvedValue('pass');
      const snapshot = makeSnapshot({ htmlPath: '/tmp/missing.html' });
      const result = await evaluator.evaluate(makeTranscript(), scenario, snapshot);
      expect(result.verdict).toBe('pass');
      const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).not.toContain('Preview body HTML');
      expect(result.details?.htmlContextAvailable).toBe(false);
    });
  });
});
