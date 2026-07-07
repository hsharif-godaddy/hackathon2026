import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Develop-owned behavior (post-deprecation): a promotion-style request without
 * explicit "campaign" language ("help me promote my business and run a holiday
 * promotion") still routes to the marketing-campaigns skill on develop and runs
 * the full CLARIFY → PLAN flow. Complements clarify-first by covering a different
 * realistic prompt phrasing.
 *
 * Note: the marketing-campaigns skill (rule 12) NEVER asks the user to choose
 * channels upfront — the agent proposes the channel mix in the plan card. This
 * scenario does NOT assert channel prompting; it asserts the routing and plan tool.
 *
 * Not subsumed by: clarify-first (same flow, different prompt style — "promote my
 * business" vs "create a campaign"). This isolates whether promotion-phrased
 * requests route correctly without explicit campaign language.
 */
export function campaignNoChannelPromptScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'marketing-campaign-no-channel-prompt',
      skill: 'marketing-campaigns',
      suite: 'marketing-campaigns',
      userIntent: 'Help me promote my business and run a holiday promotion',
      contextClaims: { marketingCampaignsEnabled: true },
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      trials: 5,
      goals: [
        {
          description:
            'The develop agent handles the promotion request directly, without handing off to a standalone marketing agent',
          assertion: 'negative',
        },
        {
          description:
            'The marketing-campaigns skill is loaded and the agent proposes a campaign plan via the campaignPlanPropose tool',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'loads-marketing-campaigns',
          instruction:
            'The marketing-campaigns skill must be loaded to handle this '
            + 'promotion request.',
          priority: 'required',
        },
        {
          id: 'proposes-via-tool',
          instruction:
            'The agent must present the campaign plan by calling the '
            + 'campaignPlanPropose tool, not as free-text prose.',
          priority: 'required',
        },
      ],
      expectedTools: [
        NO_MARKETING_HANDOFF,
        { tool: 'skill', called: true },
        { tool: 'marketing-campaigns__campaignPlanPropose', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
