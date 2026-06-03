import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { Evaluator } from '../../evaluators/evaluator.js';
import { BugHitRateEvaluator } from '../../evaluators/bug-hit-rate.js';
import { HandoffVoiceComplianceEvaluator } from '../../evaluators/handoff-voice-compliance.js';
import type { VoiceGoalMapping } from '../../evaluators/handoff-voice-compliance-types.js';
import { PromptEfficiencyEvaluator } from '../../evaluators/prompt-efficiency.js';
import { ToolCallVerificationEvaluator } from '../../evaluators/tool-call-verification.js';
import type { ScenarioGoal, SetupContext } from '../types.js';

export const HANDOFF_VOICE_BUILD_MESSAGE = [
  'Build a simple landing page for my bakery.',
  'Include a hero section, a short about section, and a contact section.',
  'Use a warm, welcoming design.',
].join(' ');

export const developOutboundGoal: ScenarioGoal = {
  description:
    'Develop outbound after "Check my SEO" (voice only — not whether SEO ran). PASS if: ' +
    'no user-facing chat before handoff, OR a brief first-person confirm as one Airo ' +
    '(e.g. "I\'ll run an SEO analysis on your site") then handoff; going straight to the ' +
    'handoff tool with zero chat is a pass. FAIL only if user-facing chat exposes the seam: ' +
    '"hand off," "hand this off," agent or role names, routing narration, or wrap-up',
  assertion: 'positive',
};

export const marketingInboundGoal: ScenarioGoal = {
  description:
    'Marketing inbound after SEO handoff (voice only). PASS if: no user-facing chat and ' +
    'proceeds directly to seoAnalysis (preferred), OR chat stays one-Airo while starting the ' +
    'SEO work. Missing assistant chat on this transition is NOT a failure. FAIL only if chat ' +
    'uses taking-over framing, a separate marketing role, routing acknowledgment, or welcome-back',
  assertion: 'positive',
};

export const marketingOutboundGoal: ScenarioGoal = {
  description:
    'Marketing outbound handback (voice only). Applies only when marketing calls handoff to ' +
    'develop in this run. PASS if: no user-facing chat before handoff and that turn ends after ' +
    'the handoff tool, OR a brief first-person echo on typed chat then handoff with no further ' +
    'user-facing chat on that turn. FAIL only if user-facing chat on that turn exposes the seam: ' +
    '"hand off," "hand this off," "handing back," agent or role names (e.g. "develop"), routing ' +
    'narration, wrap-up, or internal setup in chat (e.g. "task plan," "todos"). If marketing ' +
    'never handed back to develop, N/A — do not fail this goal',
  assertion: 'positive',
};

export const developInboundGoal: ScenarioGoal = {
  description:
    'Develop inbound after marketing hands back (voice only). Applies only when develop is ' +
    'active again after a marketing handoff to develop. PASS if: no welcome-back or agent ' +
    'recap; minimal or zero chat before work is fine. FAIL only if chat says "I\'m back," ' +
    '"welcome back," names agents or roles, or recaps who did what internally (e.g. "marketing ' +
    'finished the audit"). If marketing never handed back to develop, N/A — do not fail this goal',
  assertion: 'positive',
};

export function handoffVoiceEvaluators(
  gocode: IGocodeClient,
  goalMappings: VoiceGoalMapping[],
): Evaluator[] {
  return [
    new BugHitRateEvaluator(),
    new PromptEfficiencyEvaluator(),
    new ToolCallVerificationEvaluator(),
    new HandoffVoiceComplianceEvaluator(gocode, goalMappings),
  ];
}

export function handoffVoiceLifecycle(ctrlPlane: AABCtrlPlaneClient) {
  return {
    setup: async (): Promise<SetupContext> => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },
    teardown: async (ctx: SetupContext): Promise<void> => {
      if (ctx.appId) {
        await ctrlPlane.deleteApp(ctx.appId);
      }
    },
  };
}
