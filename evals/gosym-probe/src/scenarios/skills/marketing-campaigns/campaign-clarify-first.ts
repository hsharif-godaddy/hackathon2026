import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Develop-owned behavior (post-deprecation): an explicit campaign request is
 * handled directly on the develop agent — NO handoff to a standalone marketing
 * agent — which loads the marketing-campaigns skill, runs CLARIFY (asks before
 * acting), then proposes the plan via campaignPlanPropose. This is the
 * develop-world counterpart of the RUBICON-543 baseline (which asserted a
 * handoff to marketing); RUBICON-515 removed the marketing agent and moved the
 * capability onto develop.
 *
 * Not subsumed by: no-channel-prompt (channel elicitation) or the vague-intent
 * scenarios (routing on ambiguous prompts). This isolates CLARIFY-before-PLAN.
 *
 * Construct validity:
 * - False positive: guarded by asserting NO marketing handoff AND that
 *   campaignPlanPropose ran (on develop).
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
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      trials: 5,
      goals: [
        {
          description:
            'The develop agent handles the campaign directly, without handing off to a standalone marketing agent',
          assertion: 'negative',
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
      ],
      expectedTools: [
        NO_MARKETING_HANDOFF,
        { tool: 'skill', called: true },
        { tool: 'askQuestion', called: true },
        { tool: 'marketing-campaigns__campaignPlanPropose', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
