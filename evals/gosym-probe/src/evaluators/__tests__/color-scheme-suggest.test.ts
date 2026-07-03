import { describe, it, expect } from 'vitest';

import type { ToolCall, Transcript, Turn } from '../../runner/transcript.js';
import { ColorSchemeSuggestEvaluator } from '../color-scheme-suggest.js';

const NOOP_SCENARIO = {} as never;

function suggestCall(palettes: Array<{ name: string; palette: Record<string, string> }>): ToolCall {
  return {
    id: 'tc-1',
    name: 'colorScheme',
    input: { mode: 'suggest', description: 'photography portfolio options' },
    output: { success: true, message: `Generated ${palettes.length}`, palettes },
    startTime: 0,
    endTime: 1,
  };
}

function transcriptWith(toolCalls: ToolCall[]): Transcript {
  const turn: Turn = { role: 'assistant', content: '', toolCalls, timestamp: 0 };
  return { scenarioName: 's', trialIndex: 0, turns: [turn], snapshots: [], errors: [], captureErrors: [] };
}

// mutedForeground vs white: '#595959'≈7:1 (pass), '#CCCCCC'≈1.6:1 (fail).
const PASS = { name: 'Safe Light', palette: { primary: '#3B82F6', background: '#FFFFFF', card: '#FFFFFF', mutedForeground: '#595959' } };
const FAIL = { name: 'Faint Light', palette: { primary: '#10B981', background: '#FFFFFF', card: '#FFFFFF', mutedForeground: '#CCCCCC' } };

describe('ColorSchemeSuggestEvaluator', () => {
  const evaluator = new ColorSchemeSuggestEvaluator();

  it('is score-mode, lower-is-better (more low-contrast options = regression)', () => {
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  it('scores 0 when every suggested scheme has AA-safe muted text', async () => {
    const res = await evaluator.evaluate(transcriptWith([suggestCall([PASS, PASS])]), NOOP_SCENARIO);
    expect(res.score).toBe(0);
    expect(res.verdict).toBe('directional');
    expect(res.details?.palettesSuggested).toBe(2);
  });

  it('counts each suggested scheme whose muted text fails AA', async () => {
    const res = await evaluator.evaluate(transcriptWith([suggestCall([PASS, FAIL, FAIL])]), NOOP_SCENARIO);
    expect(res.score).toBe(2);
    expect(res.verdict).toBe('directional');
    expect(res.details?.aaFailures).toBe(2);
  });

  it('reads palettes from the widget shape too', async () => {
    const widgetCall: ToolCall = {
      id: 'tc-2',
      name: 'colorScheme',
      output: { widget: { widgetType: 'color-palette-grid', widgetData: { palettes: [FAIL] } } },
      startTime: 0,
      endTime: 1,
    };
    const res = await evaluator.evaluate(transcriptWith([widgetCall]), NOOP_SCENARIO);
    expect(res.score).toBe(1);
  });

  it('reports distinct-primary variety in details', async () => {
    const res = await evaluator.evaluate(transcriptWith([suggestCall([PASS, FAIL])]), NOOP_SCENARIO);
    expect(res.details?.distinctPrimaries).toBe(2);
  });

  it('returns verdict "unknown" when suggest mode was never called', async () => {
    const otherCall: ToolCall = { id: 'tc-3', name: 'readFile', startTime: 0, endTime: 1 };
    const res = await evaluator.evaluate(transcriptWith([otherCall]), NOOP_SCENARIO);
    expect(res.verdict).toBe('incomplete');
    expect(res.score).toBe(0);
  });
});
