import { describe, it, expect, vi } from 'vitest';

import { inboxSkillEvalScenario } from '../inbox.js';
import type { Evaluator } from '../../../evaluators/evaluator.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import {
  wrongSkillLoaded,
  noSkillLoaded,
  missingInstrumentation,
  inboxLoaded,
} from './negative-controls.js';

function stubGocode(): IGocodeClient {
  return {
    chat: vi.fn(),
    chatJson: vi.fn(),
    getModel: () => 'test-model',
    resetAccumulatedUsage: vi.fn(),
    withModel: vi.fn(),
    getAccumulatedUsage: vi.fn().mockReturnValue({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }),
  } as unknown as IGocodeClient;
}

function stubCtrlPlane(): AABCtrlPlaneClient {
  return {
    provisionApp: vi.fn(),
    deleteApp: vi.fn(),
  } as unknown as AABCtrlPlaneClient;
}

/**
 * Negative controls run the REAL inbox skill-eval scenario's deterministic
 * skill-selection evaluator (not a hand-built one) against frozen known-bad
 * transcripts. This proves the check as it actually ships has teeth: it must
 * score a fabricated "agent skipped the skill" trace as fail.
 */
describe('skill-eval inbox: negative controls', () => {
  const scenario = inboxSkillEvalScenario(stubGocode(), stubCtrlPlane());
  const skillSelection: Evaluator | undefined = scenario.evaluators.find(
    (e) => e.name === 'skill-selection',
  );

  it('the shipped scenario actually wires a skill-selection evaluator', () => {
    expect(skillSelection).toBeDefined();
  });

  it('fails when a wrong, unrelated skill was loaded (not inbox)', async () => {
    const result = await skillSelection!.evaluate(wrongSkillLoaded, scenario);
    expect(result.verdict).toBe('fail');
    expect(result.details?.missingSkills).toContain('inbox');
  });

  it('fails when no skill was loaded at all', async () => {
    const result = await skillSelection!.evaluate(noSkillLoaded, scenario);
    expect(result.verdict).toBe('fail');
  });

  it('fails loud when skill-load instrumentation is absent (broken gate)', async () => {
    const result = await skillSelection!.evaluate(
      missingInstrumentation,
      scenario,
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.skillMode).toBe('missing-instrumentation');
  });

  it('positive control: passes when inbox was loaded (check is not a stuck fail)', async () => {
    const result = await skillSelection!.evaluate(inboxLoaded, scenario);
    expect(result.verdict).toBe('pass');
  });
});
