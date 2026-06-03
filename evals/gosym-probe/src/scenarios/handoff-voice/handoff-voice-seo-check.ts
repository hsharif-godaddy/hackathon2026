import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import { handoffVoiceCheckProbePersona } from '../../personas/handoff-voice-check-probe.js';
import type { Scenario } from '../types.js';
import {
  developInboundGoal,
  developOutboundGoal,
  HANDOFF_VOICE_BUILD_MESSAGE,
  handoffVoiceEvaluators,
  handoffVoiceLifecycle,
  marketingInboundGoal,
  marketingOutboundGoal,
} from './handoff-voice-shared.js';

export function handoffVoiceSeoCheckScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const lifecycle = handoffVoiceLifecycle(ctrlPlane);

  return {
    name: 'handoff-voice-seo-check',
    persona: handoffVoiceCheckProbePersona,
    staticFirstMessage: HANDOFF_VOICE_BUILD_MESSAGE,
    trials: 2,
    expectedTools: [
      { tool: 'handoff', called: true },
      { tool: 'seoAnalysis', called: true },
    ],
    goals: [developOutboundGoal, marketingInboundGoal],
    evaluators: handoffVoiceEvaluators(gocode, [
      { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
      { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
    ]),
    setup: lifecycle.setup,
    teardown: lifecycle.teardown,
  };
}

/** Combined goals for backwards-compatible full run. */
export function handoffVoiceAllGoals() {
  return [
    developOutboundGoal,
    marketingInboundGoal,
    marketingOutboundGoal,
    developInboundGoal,
  ];
}
