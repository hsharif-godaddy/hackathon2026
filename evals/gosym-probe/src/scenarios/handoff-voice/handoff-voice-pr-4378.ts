import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import { handoffVoiceProbePersona } from '../../personas/handoff-voice-probe.js';
import type { Scenario } from '../types.js';
import { handoffVoiceAllGoals } from './handoff-voice-seo-check.js';
import {
  developInboundGoal,
  developOutboundGoal,
  HANDOFF_VOICE_BUILD_MESSAGE,
  handoffVoiceEvaluators,
  handoffVoiceLifecycle,
  marketingInboundGoal,
  marketingOutboundGoal,
} from './handoff-voice-shared.js';

/** All four voice goals in one run (legacy). Prefer handoff-voice-seo-check + handback. */
export function handoffVoicePr4378Scenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const lifecycle = handoffVoiceLifecycle(ctrlPlane);

  return {
    name: 'handoff-voice-pr-4378',
    persona: handoffVoiceProbePersona,
    staticFirstMessage: HANDOFF_VOICE_BUILD_MESSAGE,
    trials: 3,
    expectedTools: [
      { tool: 'handoff', called: true },
      { tool: 'seoAnalysis', called: true },
    ],
    goals: handoffVoiceAllGoals(),
    evaluators: handoffVoiceEvaluators(gocode, [
      { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
      { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
      { goal: marketingOutboundGoal, agent: 'marketing', direction: 'outbound' },
      { goal: developInboundGoal, agent: 'develop', direction: 'inbound' },
    ]),
    setup: lifecycle.setup,
    teardown: lifecycle.teardown,
  };
}
