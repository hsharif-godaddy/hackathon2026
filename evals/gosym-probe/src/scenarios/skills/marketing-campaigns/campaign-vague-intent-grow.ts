import { createPromptVsSkillScenario }
  from '../../prompt-vs-skill/create-prompt-vs-skill-scenario.js';
import { MARKETING_HANDOFF } from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * BASELINE (pre-deprecation): a vague growth prompt ("I want to grow my
 * business") is routed to the standalone marketing agent (handoff to
 * 'marketing') as the current behavior. GREEN against the marketing agent on
 * main today.
 *
 * Uses createPromptVsSkillScenario (no SkillSelectionEvaluator/skill-outcome),
 * so it pins no expectedSkills/expectedAgent/skillInstructions; the sole machine
 * assertion is that the marketing handoff IS called.
 *
 * Not subsumed by: clarify-first/no-channel-prompt (in-skill flow on explicit
 * requests); this isolates ROUTING of an ambiguous prompt to marketing.
 *
 * Construct validity:
 * - False positive: the handoff-to-marketing assertion is the discriminator.
 * - False negative: a vague prompt MIGHT be clarified before any handoff; if a
 *   baseline run shows these don't reliably hand off, narrow the scenario to an
 *   explicit-intent prompt or drop it.
 * - Missing coverage: plan quality is out of scope (explicit-request scenarios).
 *
 * Sibling of vague-intent-customers, varying only the prompt.
 */
export function campaignVagueIntentGrowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'marketing-campaign-vague-intent-grow',
      suite: 'marketing-campaigns',
      staticFirstMessage: 'I want to grow my business',
      contextClaims: { marketingCampaignsEnabled: true },
      trials: 3,
      goals: [
        {
          description:
            'The vague growth request is routed to the standalone marketing agent (handoff to marketing)',
          assertion: 'positive',
        },
      ],
      expectedTools: [MARKETING_HANDOFF],
    },
    gocode,
    ctrlPlane,
  );
}
