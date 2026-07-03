import type { Transcript, Turn, ToolCall } from '../../../runner/transcript.js';

/**
 * Frozen known-bad transcripts for skill-eval negative controls.
 *
 * A live skill-eval reproduction that happens to pass proves nothing about
 * whether the evaluator would catch a real failure — the agent might simply
 * have behaved. These fixtures hand-roll the failure mode ("agent skipped the
 * skill and improvised") so the deterministic skill-selection check must score
 * `fail` against them. That is what proves the check has teeth.
 *
 * Each fixture targets a scenario asserting `expectedSkills: ['inbox']` (see
 * inbox.ts). All are deterministic: no LLM, no live run.
 */

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc',
    name: 'write_file',
    startTime: 0,
    endTime: 1,
    ...overrides,
  };
}

function assistantTurn(toolCalls: ToolCall[], content: string = ''): Turn {
  return { role: 'assistant', content, toolCalls, timestamp: 0 };
}

function baseTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'skill-eval-inbox',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
    ...overrides,
  };
}

/**
 * WRONG-SKILL: instrumentation is live and reports the agent loaded an
 * unrelated skill ('seo') while hand-rolling the contact form itself, never
 * loading 'inbox'. The classic "fluffed its way through with raw file writes"
 * failure the skill-selection check exists to catch.
 */
export const wrongSkillLoaded: Transcript = baseTranscript({
  turns: [
    assistantTurn(
      [
        toolCall({ id: 't1', name: 'write_file' }),
        toolCall({ id: 't2', name: 'write_file' }),
      ],
      'I built a contact form component by hand.',
    ),
  ],
  loadedSkills: ['seo'],
});

/**
 * NO-SKILL: instrumentation is live and reports zero skills loaded. The agent
 * improvised the whole feature without reaching for any provided skill.
 */
export const noSkillLoaded: Transcript = baseTranscript({
  turns: [assistantTurn([toolCall({ id: 't1', name: 'write_file' })])],
  loadedSkills: [],
});

/**
 * MISSING-INSTRUMENTATION: the run had no skill-load instrumentation
 * (SKILL_DIAGNOSTICS off → loadedSkills absent). For a scenario whose purpose
 * is to gate on skill loading this is a broken gate, and a strict
 * skill-selection evaluator must fail loud rather than silently degrade to
 * 'unknown' and fall back to the LLM judge alone.
 */
export const missingInstrumentation: Transcript = baseTranscript({
  turns: [assistantTurn([toolCall({ id: 't1', name: 'write_file' })])],
  // loadedSkills intentionally absent
});

/**
 * POSITIVE CONTROL: the agent loaded 'inbox'. Included so the negative-control
 * suite also proves the check is not a stuck `fail` — a real pass must pass.
 */
export const inboxLoaded: Transcript = baseTranscript({
  turns: [assistantTurn([toolCall({ id: 't1', name: 'inbox__setup_form' })])],
  loadedSkills: ['inbox'],
});
