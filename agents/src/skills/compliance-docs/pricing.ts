import { getActiveAgentContext } from '../../lib/agent-context-storage.js';
import { getHivemindValue } from '../../services/switchboard.js';
import { logger } from '../../logging/index.js';

/** Hivemind experiment whose per-shopper cohort determines compliance-doc pricing. */
const COMPLIANCE_DOCS_EXPERIMENT = 'aab-compliance-docs';

export interface CompliancePricing {
  /** Credits charged per document; 0 = free. */
  cost: number;
  /** Whether the charge dialog reveals the credit amount. */
  showCost: boolean;
}

/**
 * Map an experiment cohort to pricing. FREE / unknown / unassigned cohorts (and
 * any lookup failure) resolve to free — the safe default, so a shopper is only
 * charged when their cohort explicitly carries a positive cost.
 */
function pricingForCohort(cohort: string): CompliancePricing {
  switch (cohort) {
    case 'CHARGE_SHOWN_1': return { cost: 1, showCost: true };
    case 'CHARGE_SHOWN_2': return { cost: 2, showCost: true };
    case 'CHARGE_HIDDEN_1': return { cost: 1, showCost: false };
    case 'CHARGE_HIDDEN_2': return { cost: 2, showCost: false };
    case 'FREE':
    default: return { cost: 0, showCost: false };
  }
}

/**
 * Compliance-doc pricing for the current shopper, from the `aab-compliance-docs`
 * Hivemind cohort. The cost is variable and may be 0 (free).
 *
 * Everything downstream — the charge, the confirmation-dialog copy, and the
 * skip-when-free behavior — derives from this; never hardcode the values.
 */
export function getComplianceDocPricing(): CompliancePricing {
  const shopperId: string | undefined = getActiveAgentContext()?.shopperId;
  // Hivemind returns the cohort as `{ cohortId, data }`.
  const cohort: string =
    getHivemindValue<{ cohortId?: string }>(COMPLIANCE_DOCS_EXPERIMENT, {}, shopperId).cohortId ?? 'FREE';
  const pricing: CompliancePricing = pricingForCohort(cohort);
  // ponytail: diagnostic — confirms whether the experiment resolved or fell back
  // to the FREE default. Drop once cohort resolution is verified in each env.
  logger.info('skills.compliance-docs.pricing.resolved', {
    experiment: COMPLIANCE_DOCS_EXPERIMENT,
    hasShopperId: shopperId != null,
    cohort,
    cost: pricing.cost,
    showCost: pricing.showCost,
  });
  return pricing;
}

/** Credit cost per document (0 = free). Convenience for the charge/gate callers. */
export function getComplianceDocCreditCost(): number {
  return getComplianceDocPricing().cost;
}
