import { describe, it, expect } from 'vitest';

import type { DOMSnapshot, Transcript, Turn, ToolCall } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';
import {
  buildConversationText,
  summarizeToolCalls,
  lastSnapshotSection,
} from '../../shared.js';
import { buildAlignmentEvidence } from '../alignment-evidence.js';

function makeTurn(
  role: 'user' | 'assistant',
  content: string,
  toolCalls: ToolCall[] = [],
): Turn {
  return { role, content, toolCalls, timestamp: 0 };
}

function makeToolCall(name: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'tc1', name, input: { key: 'val' }, output: 'result', startTime: 0, endTime: 10, ...overrides };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: { name: 'p', description: 'd', systemPrompt: 'You are a test user.' },
    goals: [{ description: 'Goal one', assertion: 'positive' }],
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}

function makeTranscript(turns: Turn[] = [], errors: string[] = []): Transcript {
  return {
    scenarioName: 'test-scenario',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors,
    captureErrors: [],
  };
}

function makeInlineSnapshot(
  html: string,
  consoleLogs: Array<{ type: string; text: string }> = [],
): DOMSnapshot {
  return {
    url: 'https://example.test',
    screenshotPath: '/tmp/test.png',
    htmlPath: '',
    timestamp: new Date().toISOString(),
    consoleLogs,
    html,
  };
}

// ---------------------------------------------------------------------------
// buildConversationText
// ---------------------------------------------------------------------------

describe('buildConversationText', () => {
  it('returns empty string for empty turns array', () => {
    expect(buildConversationText([])).toBe('');
  });

  it('formats each turn as ROLE: content', () => {
    const turns = [makeTurn('user', 'Hello'), makeTurn('assistant', 'Hi there')];
    const result = buildConversationText(turns);
    expect(result).toContain('USER: Hello');
    expect(result).toContain('ASSISTANT: Hi there');
  });

  it('truncates at 20,000 chars with truncation marker', () => {
    const longContent = 'x'.repeat(25_000);
    const turns = [makeTurn('user', longContent)];
    const result = buildConversationText(turns);
    expect(result.length).toBeLessThan(25_000);
    expect(result).toContain('... [truncated]');
  });

  it('handles turns with empty content', () => {
    const turns = [makeTurn('user', '')];
    const result = buildConversationText(turns);
    expect(result).toContain('USER:');
  });
});

// ---------------------------------------------------------------------------
// summarizeToolCalls
// ---------------------------------------------------------------------------

describe('summarizeToolCalls', () => {
  it('returns (none) for empty array', () => {
    expect(summarizeToolCalls([])).toBe('(none)');
  });

  it('includes tool name, status, input, and output', () => {
    const calls = [makeToolCall('write_file', { input: { path: 'index.html' }, output: 'ok' })];
    const result = summarizeToolCalls(calls);
    expect(result).toContain('write_file');
    expect(result).toContain('ok');
    expect(result).toContain('index.html');
  });

  it('marks tool call as error when error field is set', () => {
    const calls = [makeToolCall('read_file', { error: 'ENOENT', output: undefined })];
    const result = summarizeToolCalls(calls);
    expect(result).toContain('error=ENOENT');
  });

  it('truncates individual tool output at 600 chars', () => {
    const longOutput = 'z'.repeat(1_000);
    const calls = [makeToolCall('get_page', { output: longOutput })];
    const result = summarizeToolCalls(calls);
    // The output JSON string will be quoted, so just verify total line length is bounded
    expect(result).toContain('... [truncated]');
    // Verify the output portion is not the full 1000 chars
    const outputIdx = result.indexOf('output=');
    const outputSlice = result.slice(outputIdx);
    expect(outputSlice.length).toBeLessThan(900);
  });

  it('truncates total summary at 20,000 chars', () => {
    const calls = Array.from({ length: 100 }, (_, i) =>
      makeToolCall(`tool_${i}`, { output: 'x'.repeat(500) }),
    );
    const result = summarizeToolCalls(calls);
    expect(result.length).toBeLessThanOrEqual(20_020); // allow for truncation suffix
    expect(result).toContain('... [truncated]');
  });
});

// ---------------------------------------------------------------------------
// lastSnapshotSection
// ---------------------------------------------------------------------------

describe('lastSnapshotSection', () => {
  it('returns (no snapshot) when snapshot is undefined', async () => {
    const result = await lastSnapshotSection(undefined);
    expect(result).toBe('(no snapshot)');
  });

  it('uses inline html when snapshot.html is set', async () => {
    const snapshot = makeInlineSnapshot('<html><body><h1>Hello</h1></body></html>');
    const result = await lastSnapshotSection(snapshot);
    expect(result).toContain('Hello');
    expect(result).toContain('URL: https://example.test');
  });

  it('includes BODY_HTML and BODY_TEXT sections', async () => {
    const snapshot = makeInlineSnapshot('<html><body><p>Test content</p></body></html>');
    const result = await lastSnapshotSection(snapshot);
    expect(result).toContain('BODY_HTML:');
    expect(result).toContain('BODY_TEXT:');
    expect(result).toContain('Test content');
  });

  it('tails console logs to last 30 entries', async () => {
    const consoleLogs = Array.from({ length: 50 }, (_, i) => ({
      type: 'log',
      text: `message-${i}`,
    }));
    const snapshot = makeInlineSnapshot('<html><body></body></html>', consoleLogs);
    const result = await lastSnapshotSection(snapshot);
    // Last 30: indices 20-49
    expect(result).toContain('message-49');
    expect(result).toContain('message-20');
    // First 20 should NOT appear
    expect(result).not.toContain('message-0');
    expect(result).not.toContain('message-19');
  });

  it('shows (none) for console logs when empty', async () => {
    const snapshot = makeInlineSnapshot('<html><body></body></html>', []);
    const result = await lastSnapshotSection(snapshot);
    expect(result).toContain('CONSOLE_LOGS (tail):');
    expect(result).toContain('(none)');
  });

  it('returns (empty) for body when html has no body content', async () => {
    const snapshot = makeInlineSnapshot('<html><body></body></html>');
    const result = await lastSnapshotSection(snapshot);
    expect(result).toContain('(empty)');
  });
});

// ---------------------------------------------------------------------------
// buildAlignmentEvidence
// ---------------------------------------------------------------------------

describe('buildAlignmentEvidence', () => {
  it('includes scenario name and goals', async () => {
    const scenario = makeScenario({
      name: 'my-scenario',
      goals: [{ description: 'User built a portfolio', assertion: 'positive' }],
    });
    const result = await buildAlignmentEvidence(makeTranscript(), scenario);
    expect(result).toContain('SCENARIO: my-scenario');
    expect(result).toContain('User built a portfolio');
  });

  it('shows (none) for goals when goals array is empty', async () => {
    const scenario = makeScenario({ goals: [] });
    const result = await buildAlignmentEvidence(makeTranscript(), scenario);
    expect(result).toContain('GOALS: (none)');
  });

  it('includes persona system prompt truncated to 3,000 chars', async () => {
    const longPrompt = 'p'.repeat(5_000);
    const scenario = makeScenario({
      persona: { name: 'p', description: 'd', systemPrompt: longPrompt },
    });
    const result = await buildAlignmentEvidence(makeTranscript(), scenario);
    expect(result).toContain('PERSONA_SYSTEM_PROMPT:');
    expect(result).toContain('... [truncated]');
    // Persona section should not include the full 5000 chars
    const personaIdx = result.indexOf('PERSONA_SYSTEM_PROMPT:');
    const afterPersona = result.slice(personaIdx, personaIdx + 3_200);
    expect(afterPersona.length).toBeLessThan(3_200);
  });

  it('shows (none) for persona system prompt when systemPrompt is missing', async () => {
    const scenario = makeScenario({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persona: { name: 'p', description: 'd' } as any,
    });
    const result = await buildAlignmentEvidence(makeTranscript(), scenario);
    expect(result).toContain('PERSONA_SYSTEM_PROMPT:');
    // Should not throw, and should show (none) or empty fallback
    expect(result).toMatch(/PERSONA_SYSTEM_PROMPT:\n\(none\)/);
  });

  it('includes conversation section', async () => {
    const turns = [makeTurn('user', 'Build me a site'), makeTurn('assistant', 'Sure!')];
    const result = await buildAlignmentEvidence(makeTranscript(turns), makeScenario());
    expect(result).toContain('CONVERSATION:');
    expect(result).toContain('USER: Build me a site');
    expect(result).toContain('ASSISTANT: Sure!');
  });

  it('includes tool calls section', async () => {
    const toolCall = makeToolCall('write_file', { input: { path: 'index.html' } });
    const turns = [makeTurn('assistant', 'Creating file', [toolCall])];
    const result = await buildAlignmentEvidence(makeTranscript(turns), makeScenario());
    expect(result).toContain('TOOL_CALLS (summarized):');
    expect(result).toContain('write_file');
  });

  it('includes META line with totalToolCalls and transcriptErrors', async () => {
    const toolCall = makeToolCall('write_file');
    const turns = [makeTurn('assistant', 'done', [toolCall])];
    const result = await buildAlignmentEvidence(makeTranscript(turns, ['err1']), makeScenario());
    expect(result).toContain('META: totalToolCalls=1 transcriptErrors=1');
  });

  it('includes FINAL_SITE section with snapshot content', async () => {
    const snapshot = makeInlineSnapshot('<html><body><h1>My Site</h1></body></html>');
    const result = await buildAlignmentEvidence(makeTranscript(), makeScenario(), snapshot);
    expect(result).toContain('FINAL_SITE (last snapshot):');
    expect(result).toContain('My Site');
  });

  it('shows (no snapshot) in FINAL_SITE when no snapshot provided', async () => {
    const result = await buildAlignmentEvidence(makeTranscript(), makeScenario(), undefined);
    expect(result).toContain('FINAL_SITE (last snapshot):');
    expect(result).toContain('(no snapshot)');
  });

  it('strips SVG from FINAL_SITE snapshot body (seam: uses sanitized path)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0"/></svg>';
    const snapshot = makeInlineSnapshot(`<html><body>${svg}<p>Contact us</p></body></html>`);
    const result = await buildAlignmentEvidence(makeTranscript(), makeScenario(), snapshot);
    expect(result).toContain('Contact us');
    expect(result).not.toContain('<svg');
    expect(result).not.toContain('<rect');
  });
});
