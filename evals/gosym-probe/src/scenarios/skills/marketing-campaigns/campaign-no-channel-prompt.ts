import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  MARKETING_AGENT_DISPLAY_NAME,
  MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * BASELINE (pre-deprecation): a promote-my-business request naming no channel is
 * routed to the standalone marketing agent (handoff to 'marketing'), which asks
 * which channel(s) to use before proposing a multi-channel plan via
 * campaignPlanPropose. GREEN against the marketing agent on main today.
 *
 * Not subsumed by: clarify-first (CLARIFY-before-PLAN on a specified intent);
 * this isolates CHANNEL elicitation on an unspecified-channel intent.
 *
 * Construct validity:
 * - False positive: guarded by the marketing handoff + campaignPlanPropose.
 * - False negative: same multi-turn-reachability caveat as clarify-first.
 * - Missing coverage: channel-mix quality is advisory, not pinned to a set.
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
      expectedAgent: MARKETING_AGENT_DISPLAY_NAME,
      trials: 5,
      goals: [
        {
          description:
            'The request is routed to the standalone marketing agent (handoff to marketing), which handles the promotion',
          assertion: 'positive',
        },
        {
          description:
            'The agent asks which channel(s) to use before proposing the campaign',
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
          id: 'prompts-for-channel',
          instruction:
            'When the user names no channel, the agent must ask which '
            + 'channel(s) to run the promotion on (e.g. email, social, ads) '
            + 'before proposing or creating the campaign.',
          priority: 'required',
        },
        {
          id: 'proposes-via-tool',
          instruction:
            'The agent must present the campaign plan by calling the '
            + 'campaignPlanPropose tool, not as free-text prose.',
          priority: 'required',
        },
        {
          id: 'recommends-channel-mix',
          instruction:
            'The proposed plan should recommend a multi-channel mix and explain '
            + 'the rationale for each channel rather than only listing channels.',
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
