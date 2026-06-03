import { describe, expect, it } from 'vitest';

import {
  makeCtrlPlaneClient,
  makeGocodeClient,
} from '../../__tests__/scenario-test-helpers.js';
import { handoffVoiceHandbackScenario } from '../handoff-voice-handback.js';
import { handoffVoicePr4378Scenario } from '../handoff-voice-pr-4378.js';
import { handoffVoiceSeoCheckScenario } from '../handoff-voice-seo-check.js';

describe('handoff-voice scenarios', function handoffVoiceScenarios() {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  it('seo-check covers develop outbound and marketing inbound', function seoCheckShape() {
    const scenario = handoffVoiceSeoCheckScenario(gocode, ctrlPlane);

    expect(scenario.name).toBe('handoff-voice-seo-check');
    expect(scenario.suite).toBeUndefined();
    expect(scenario.staticFirstMessage).toContain('bakery');
    expect(scenario.trials).toBe(2);
    expect(scenario.goals).toHaveLength(2);
    expect(scenario.persona.name).toBe('handoff-voice-check-probe');
    expect(scenario.expectedTools).toEqual([
      { tool: 'handoff', called: true },
      { tool: 'seoAnalysis', called: true },
    ]);
  });

  it('handback covers marketing outbound and develop inbound', function handbackShape() {
    const scenario = handoffVoiceHandbackScenario(gocode, ctrlPlane);

    expect(scenario.name).toBe('handoff-voice-handback');
    expect(scenario.suite).toBeUndefined();
    expect(scenario.trials).toBe(2);
    expect(scenario.goals).toHaveLength(2);
    expect(scenario.persona.name).toBe('handoff-voice-handback-probe');
    expect(scenario.expectedTools).toEqual([
      { tool: 'handoff', called: true },
      { tool: 'seoAnalysis', called: true },
      { tool: 'todoList', called: true },
    ]);
  });

  it('legacy pr-4378 combines all four goals', function legacyShape() {
    const scenario = handoffVoicePr4378Scenario(gocode, ctrlPlane);

    expect(scenario.name).toBe('handoff-voice-pr-4378');
    expect(scenario.goals).toHaveLength(4);
    expect(scenario.evaluators.map((e) => e.name)).toEqual([
      'bug-hit-rate',
      'prompt-efficiency',
      'tool-call-verification',
      'handoff-voice-compliance',
    ]);
  });
});
