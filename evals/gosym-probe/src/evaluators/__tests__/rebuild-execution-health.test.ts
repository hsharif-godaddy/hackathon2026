import { describe, expect, it } from 'vitest';

import {
  isRebuildBuildPageToolName,
  isRebuildToolName,
  isWaitForIntakeToolName,
  isWebsiteRebuildToolName,
  parseToolOutputRecord,
  parseWebsiteRebuildOutcome,
  RebuildExecutionHealthEvaluator,
  rebuildExecutionHealth,
  websiteRebuildFailurePenalty,
  websiteRebuildOk,
} from '../rebuild-execution-health.js';
import {
  makeAssistantTurn,
  makeScenario,
  makeToolCall,
  makeTranscript,
} from './evaluator-test-helpers.js';

describe('rebuildExecutionHealth', () => {
  it('returns 1 when no penalties', () => {
    expect(rebuildExecutionHealth(0, 0)).toBe(1);
  });

  it('halves score for one penalty', () => {
    expect(rebuildExecutionHealth(1, 0)).toBe(0.5);
  });

  it('includes websiteRebuild failure penalty', () => {
    expect(rebuildExecutionHealth(0, 0, 1)).toBe(0.5);
  });
});

describe('isWebsiteRebuildToolName', () => {
  it('matches canonical and namespaced variants', () => {
    expect(isWebsiteRebuildToolName('websiteRebuild')).toBe(true);
    expect(isWebsiteRebuildToolName('website_rebuild')).toBe(true);
    expect(isWebsiteRebuildToolName('develop__websiteRebuild')).toBe(true);
    expect(isWebsiteRebuildToolName('rebuildBuildPage')).toBe(false);
  });
});

describe('isRebuildBuildPageToolName', () => {
  it('matches canonical and namespaced variants', () => {
    expect(isRebuildBuildPageToolName('rebuildBuildPage')).toBe(true);
    expect(isRebuildBuildPageToolName('rebuild_build_page')).toBe(true);
    expect(isRebuildBuildPageToolName('page__rebuildBuildPage')).toBe(true);
  });
});

describe('isWaitForIntakeToolName', () => {
  it('matches canonical and namespaced variants', () => {
    expect(isWaitForIntakeToolName('waitForIntake')).toBe(true);
    expect(isWaitForIntakeToolName('wait_for_intake')).toBe(true);
    expect(isWaitForIntakeToolName('rebuild__waitForIntake')).toBe(true);
  });
});

describe('isRebuildToolName', () => {
  it('matches rebuild tool variants', () => {
    expect(isRebuildToolName('websiteRebuild')).toBe(true);
    expect(isRebuildToolName('develop__websiteRebuild')).toBe(true);
    expect(isRebuildToolName('rebuildBuildPage')).toBe(true);
    expect(isRebuildToolName('waitForIntake')).toBe(true);
    expect(isRebuildToolName('create-page')).toBe(false);
  });
});

describe('parseToolOutputRecord', () => {
  it('parses JSON string tool output', () => {
    expect(parseToolOutputRecord('{"success":true}')).toEqual({ success: true });
  });

  it('returns null for non-object JSON', () => {
    expect(parseToolOutputRecord('["not","an","object"]')).toBeNull();
    expect(parseToolOutputRecord('not-json')).toBeNull();
  });
});

describe('parseWebsiteRebuildOutcome', () => {
  it('parses websiteRebuild output fields', () => {
    const outcome = parseWebsiteRebuildOutcome([
      makeToolCall({
        id: 'tc-1',
        name: 'websiteRebuild',
        output: {
          success: false,
          intakeTimedOut: true,
          handoffTriggered: false,
        },
      }),
    ]);

    expect(outcome.called).toBe(true);
    expect(outcome.succeeded).toBe(false);
    expect(outcome.intakeTimedOut).toBe(true);
    expect(outcome.handoffTriggered).toBe(false);
    expect(outcome.outputUnparseable).toBe(false);
  });

  it('parses JSON string websiteRebuild output', () => {
    const outcome = parseWebsiteRebuildOutcome([
      makeToolCall({
        id: 'tc-1',
        name: 'websiteRebuild',
        output: JSON.stringify({ success: true, handoffTriggered: true }),
      }),
    ]);

    expect(outcome.succeeded).toBe(true);
    expect(outcome.handoffTriggered).toBe(true);
    expect(outcome.outputUnparseable).toBe(false);
  });

  it('uses the worst outcome when websiteRebuild is called multiple times', () => {
    const outcome = parseWebsiteRebuildOutcome([
      makeToolCall({
        id: 'tc-1',
        name: 'websiteRebuild',
        output: { success: true },
      }),
      makeToolCall({
        id: 'tc-2',
        name: 'websiteRebuild',
        output: { success: false },
      }),
    ]);

    expect(outcome.succeeded).toBe(false);
  });

  it('treats success true followed by unparseable output as not OK', () => {
    const outcome = parseWebsiteRebuildOutcome([
      makeToolCall({
        id: 'tc-1',
        name: 'websiteRebuild',
        output: { success: true },
      }),
      makeToolCall({
        id: 'tc-2',
        name: 'websiteRebuild',
        output: 'not-json',
      }),
    ]);

    expect(outcome.succeeded).toBeNull();
    expect(outcome.outputUnparseable).toBe(true);
    expect(websiteRebuildFailurePenalty(outcome)).toBe(1);
  });

  it('treats unparseable output followed by success true as not OK', () => {
    const outcome = parseWebsiteRebuildOutcome([
      makeToolCall({
        id: 'tc-1',
        name: 'websiteRebuild',
        output: 'not-json',
      }),
      makeToolCall({
        id: 'tc-2',
        name: 'websiteRebuild',
        output: { success: true },
      }),
    ]);

    expect(outcome.succeeded).toBeNull();
    expect(outcome.outputUnparseable).toBe(true);
    expect(websiteRebuildFailurePenalty(outcome)).toBe(1);
  });
});

describe('websiteRebuildOk', () => {
  it('treats unparseable success as not OK', () => {
    expect(websiteRebuildOk({
      called: true,
      succeeded: null,
      intakeTimedOut: false,
      handoffTriggered: false,
      outputUnparseable: true,
    })).toBe(false);
    expect(websiteRebuildFailurePenalty({
      called: true,
      succeeded: null,
      intakeTimedOut: false,
      handoffTriggered: false,
      outputUnparseable: true,
    })).toBe(1);
  });
});

describe('RebuildExecutionHealthEvaluator', () => {
  const evaluator = new RebuildExecutionHealthEvaluator();
  const scenario = makeScenario();

  it('returns unknown when no rebuild tools ran', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({
          toolCalls: [makeToolCall({ id: 'tc-1', name: 'create-page' })],
        }),
      ]),
      scenario,
    );

    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('scores healthy rebuild with no errors', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({
          toolCalls: [
            makeToolCall({
              id: 'tc-1',
              name: 'websiteRebuild',
              output: { success: true, handoffTriggered: true },
            }),
            makeToolCall({ id: 'tc-2', name: 'rebuildBuildPage' }),
          ],
        }),
      ]),
      scenario,
    );

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('directional');
    expect(result.details?.handoffTriggered).toBe(true);
    expect(result.details?.penalty).toBe(0);
  });

  it('penalizes errors, websiteRebuild failure, and unparseable output', async () => {
    const transcript = makeTranscript([
      makeAssistantTurn({
        toolCalls: [
          makeToolCall({
            id: 'tc-1',
            name: 'websiteRebuild',
            output: { success: false },
          }),
          makeToolCall({
            id: 'tc-2',
            name: 'edit-file',
            error: 'permission denied',
          }),
        ],
      }),
    ]);
    transcript.errors = ['agent_error_trace_tool'];

    const result = await evaluator.evaluate(transcript, scenario);

    expect(result.score).toBe(0.25);
    expect(result.verdict).toBe('directional');
    expect(result.details?.penalty).toBe(3);
  });

  it('penalizes websiteRebuild with missing success field', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({
          toolCalls: [
            makeToolCall({
              id: 'tc-1',
              name: 'websiteRebuild',
              output: { handoffTriggered: true },
            }),
          ],
        }),
      ]),
      scenario,
    );

    expect(result.score).toBe(0.5);
    expect(result.details?.websiteRebuildOk).toBe(false);
    expect(result.details?.websiteRebuildOutputUnparseable).toBe(true);
    expect(result.reason).toContain('websiteRebuild output unparseable');
  });
});
