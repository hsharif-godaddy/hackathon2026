import { createSkillEval } from './create-skill-eval.js';
import { getSkillEvalBaseInjection }
  from './skill-eval-base.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import type { Config }
  from '../../../config/environments/types.js';

/**
 * Reproduces the **wrong skill routing** failure mode for commerce (squad task
 * 2a.ii): the agent reaches for a skill, but the wrong one. Selling a product
 * *catalog* with inventory is the `commerce` skill's job — it owns GoDaddy
 * Commerce store setup, catalog/product data, and installs the `commerce/ui`
 * template pack. A plausible misroute, and the one the payment/commerce
 * unification work explicitly set out to fix ("unify Stripe & GoDaddy Commerce
 * under payment and select the right one"), is the agent reaching for the
 * generic `payment` router / Stripe checkout flow instead — which handles a
 * one-off charge but gives the user no store, catalog, or inventory.
 *
 * Detection (two independent signals):
 *  - `expectedSkills: ['commerce']` → `SkillSelectionEvaluator` skill-load
 *    check: fails if commerce never loads (e.g. payment loaded instead). Needs
 *    `SKILL_DIAGNOSTICS=true`; without it the check degrades to `unknown`.
 *  - the required `no-payment-router` instruction → narrow LLM judge fails the
 *    trial if the agent routes to payment/stripe checkout, an
 *    instrumentation-independent catch for the misroute.
 *
 * `expectedAgent` is intentionally omitted: both correct and misrouted paths
 * run under the same develop agent, so the discriminating signal is *which
 * skill* loaded, not which agent.
 */
export function commerceVsPaymentRoutingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'wrong-skill-routing-commerce-vs-payment',
      skill: 'commerce',
      userIntent:
        'I want to sell my handmade candles online — a shop page with each '
        + 'product, prices, and stock counts so I can manage what\'s in stock.',
      goals: [
        {
          description:
            'Agent routes the storefront/catalog request to the commerce '
            + 'skill, not the generic payment/Stripe checkout flow',
          assertion: 'positive',
        },
        {
          description:
            'The site gains a product catalog with per-product pricing and '
            + 'inventory the owner can manage',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'routes-to-commerce',
          instruction:
            'The agent must handle this with the commerce skill (GoDaddy '
            + 'Commerce store/channel setup via commerce__commerce_store_setup, '
            + 'then the commerce/ui template pack for the catalog UI). The ask '
            + 'is a product catalog with inventory, which is commerce\'s job.',
          priority: 'required',
        },
        {
          id: 'no-payment-router',
          instruction:
            'The agent must NOT route this to the generic payment router or '
            + 'the Stripe flow as the primary solution. A one-off Stripe '
            + 'checkout / payment page gives no catalog or inventory '
            + 'management and is the wrong-skill misroute this scenario '
            + 'detects. (Checkout is a later step the commerce flow hands off '
            + 'to payment/godaddy-payments — it is not the entry point here.)',
          priority: 'required',
        },
      ],
      statefulInjection: base?.injection,
    },
    gocode,
    ctrlPlane,
    base?.seedSummary,
  );
}
