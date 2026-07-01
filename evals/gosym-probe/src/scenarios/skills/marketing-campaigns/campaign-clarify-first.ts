import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  MARKETING_AGENT_DISPLAY_NAME,
  MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * BASELINE (pre-deprecation): captures CURRENT behavior — an explicit campaign
 * request is routed to the standalone marketing agent (handoff to 'marketing'),
 * which loads the marketing-campaigns skill, runs CLARIFY (asks before acting),
 * then proposes the plan via campaignPlanPropose. GREEN against the marketing
 * agent on main today; this is the baseline RUBICON-543 captures before
 * marketing migrates onto develop (at which point the suite flips to a
 * no-handoff assertion / expectedAgent develop).
 *
 * Not subsumed by: no-channel-prompt (channel elicitation) or the vague-intent
 * scenarios (routing on ambiguous prompts). This isolates CLARIFY-before-PLAN.
 *
 * Construct validity:
 * - False positive: guarded by asserting the handoff to marketing IS called
 *   AND that campaignPlanPropose ran (under the marketing agent).
 * - False negative: campaignPlanPropose assumes the trial proceeds past CLARIFY;
 *   if flaky, relax to { tool: 'marketing-campaigns__', match: 'prefix' }.
 * - Missing coverage: plan quality beyond "educates" is left to unit tests.
 */
export function campaignClarifyFirstScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'marketing-campaign-clarify-first',
      skill: 'marketing-campaigns',
      suite: 'marketing-campaigns',
      userIntent: 'Create a marketing campaign for my summer sale',
      contextClaims: { marketingCampaignsEnabled: true },
      expectedAgent: MARKETING_AGENT_DISPLAY_NAME,
      trials: 3,
      goals: [
        {
          description:
            'The request is routed to the standalone marketing agent (handoff to marketing), which handles the campaign',
          assertion: 'positive',
        },
        {
          description:
            'The marketing-campaigns skill is loaded to handle the campaign request',
          assertion: 'positive',
        },
        {
          description:
            'The agent asks at least one clarifying question (audience, dates, budget, or channel) before proposing the campaign',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'loads-marketing-campaigns',
          instruction:
            'The marketing-campaigns skill must be loaded to handle the '
            + 'campaign request.',
          priority: 'required',
        },
        {
          id: 'clarifies-before-plan',
          instruction:
            'The agent must ask at least one clarifying question (target '
            + 'audience, campaign dates, budget, or channel) BEFORE proposing '
            + 'or creating the campaign — CLARIFY precedes PLAN.',
          priority: 'required',
        },
        {
          id: 'proposes-via-tool',
          instruction:
            'The agent must present the campaign plan by calling the '
            + 'campaignPlanPropose tool, not by describing the plan as '
            + 'free-text prose in chat.',
          priority: 'required',
        },
        {
          id: 'plan-educates',
          instruction:
            'The proposed plan should explain the recommended channel mix and '
            + 'why each asset serves the campaign goal, not merely list assets.',
          priority: 'advisory',
        },
      ],
      expectedTools: [
        MARKETING_HANDOFF,
        { tool: 'skill', called: true },
        { tool: 'askQuestion', called: true },
        { tool: 'marketing-campaigns__campaignPlanPropose', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
