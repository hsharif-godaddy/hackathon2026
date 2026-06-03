import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import { handoffVoiceHandbackProbePersona } from '../../personas/handoff-voice-handback-probe.js';
import type { Scenario } from '../types.js';
import {
  developInboundGoal,
  HANDOFF_VOICE_BUILD_MESSAGE,
  handoffVoiceEvaluators,
  handoffVoiceLifecycle,
  marketingOutboundGoal,
} from './handoff-voice-shared.js';

export function handoffVoiceHandbackScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const lifecycle = handoffVoiceLifecycle(ctrlPlane);

  return {
    name: 'handoff-voice-handback',
    persona: handoffVoiceHandbackProbePersona,
    staticFirstMessage: HANDOFF_VOICE_BUILD_MESSAGE,
    trials: 2,
    expectedTools: [
      { tool: 'handoff', called: true },
      { tool: 'seoAnalysis', called: true },
      { tool: 'todoList', called: true },
    ],
    goals: [marketingOutboundGoal, developInboundGoal],
    evaluators: handoffVoiceEvaluators(gocode, [
      { goal: marketingOutboundGoal, agent: 'marketing', direction: 'outbound' },
      { goal: developInboundGoal, agent: 'develop', direction: 'inbound' },
    ]),
    setup: lifecycle.setup,
    teardown: lifecycle.teardown,
  };
}
