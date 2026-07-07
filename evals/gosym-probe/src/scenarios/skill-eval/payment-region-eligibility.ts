import { createSkillEval } from './create-skill-eval.js';
import { getSkillEvalBaseInjection } from './skill-eval-base.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import type { Config } from '../../../config/environments/types.js';

/**
 * PE 1.3 (Critical) — payment region eligibility. GoDaddy Payments (GDP) is
 * only eligible for merchants based in the US and Canada. A merchant outside
 * the US/CA (here, Australia) must be blocked from GDP and routed to Stripe (or
 * an explicit third-party alternate) BEFORE any pay-button or checkout build —
 * not after a failed GDP setup at launch, which wastes time and credits.
 *
 * The `payment` router is still the correct top-level skill (it owns provider
 * selection), so `expectedSkills: ['payment']`. The discriminating signal is
 * behavioral: the agent must NOT load/provision `payment/godaddy-payments` for
 * this region and must route to Stripe. Two `required` instructions encode the
 * block and the correct route for the LLM judge; the GDP `markets: [en-US,
 * es-US, en-CA, fr-CA]` frontmatter gate enforces it in code at load time.
 */
export function paymentRegionEligibilityScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'payment-region-eligibility-non-us-ca',
      skill: 'payment',
      userIntent:
        'I run a small business in Australia and I want to accept payments ' +
        'on my website so customers can buy my products.',
      goals: [
        {
          description:
            'Agent routes the Australian merchant to Stripe (or an explicit ' +
            'third-party alternate), not GoDaddy Payments',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT provision or install GoDaddy Payments for a ' +
            'merchant outside the US and Canada',
          assertion: 'negative',
        },
      ],
      skillInstructions: [
        {
          id: 'no-gdp-outside-us-ca',
          instruction:
            'GoDaddy Payments is only eligible in the US and Canada. For this ' +
            'Australian merchant the agent must NOT load, provision, or ' +
            'install payment/godaddy-payments, and must NOT build any pay ' +
            'button or checkout against it. Doing so is the region-' +
            'eligibility failure (PE 1.3, Critical).',
          priority: 'required',
        },
        {
          id: 'routes-to-stripe',
          instruction:
            'The agent must route to Stripe (payment/stripe) or offer an ' +
            'explicit third-party alternate, and must explain that GoDaddy ' +
            'Payments is only available in the US and Canada.',
          priority: 'required',
        },
      ],
      statefulInjection: base?.injection,
    },
    gocode,
    ctrlPlane,
    base?.seedSummary
  );
}
