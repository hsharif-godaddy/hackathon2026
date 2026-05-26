import type { NextRequest } from 'next/server';

import { BUDGET_SERVICE_BMS_COHORT, EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments';
import { logger } from '@/lib/request-context';
import gasket from '../../gasket';

const EXCLUDED_COHORTS = new Set([
  INELIGIBLE_COHORT,
  'unassigned',
  'not_bucketed',
]);

/**
 * Normalize a Hivemind cohort entry (flat string or `{ cohortId }` object).
 */
export function normalizeHivemindCohort(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const cohortId = (value as { cohortId?: unknown }).cohortId;
    if (typeof cohortId === 'string' && cohortId.length > 0) {
      return cohortId;
    }
  }
  return undefined;
}

/**
 * Fetch Hivemind cohort assignments for the current request.
 */
export async function fetchHivemindCohorts(
  request: NextRequest,
): Promise<Record<string, unknown> | undefined> {
  try {
    const getExperimentCohorts = gasket.actions.getExperimentCohorts;
    if (typeof getExperimentCohorts !== 'function') {
      return undefined;
    }
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    return await getExperimentCohorts({ headers: headersObj });
  } catch (error) {
    logger.warn('hivemind.cohorts.fetch-error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export function getBudgetServiceCohort(
  hivemindCohorts: Record<string, unknown> | undefined,
): string | undefined {
  return normalizeHivemindCohort(hivemindCohorts?.[EXPERIMENT_IDS.budgetService]);
}

/**
 * Whether the budget-service experiment allows BMS for this request.
 *
 * Precedence:
 *   1. Switchboard `app-builder-budget-service` OFF → false (grants)
 *   2. Switchboard ON + cohort `bms` → true (treatment)
 *   3. Switchboard ON + cohort `off` or any other value → false (grants)
 */
export function isBudgetServiceExperimentTreatment(
  budgetServiceSwitchboardEnabled: boolean,
  cohort: string | undefined,
): boolean {
  if (!budgetServiceSwitchboardEnabled) {
    return false;
  }
  return cohort === BUDGET_SERVICE_BMS_COHORT;
}

export function logBudgetServiceExperimentTriggered(
  cohort: string | undefined,
  context: { siteId?: string; customerId?: string; subscriptionId?: string },
): void {
  if (!cohort || EXCLUDED_COHORTS.has(cohort)) {
    return;
  }
  logger.info('hivemind.experiment.triggered', {
    experimentId: EXPERIMENT_IDS.budgetService,
    cohortId: cohort,
    siteId: context.siteId,
    customerId: context.customerId,
    subscriptionId: context.subscriptionId,
  });
}

// Intentionally does not filter EXCLUDED_COHORTS — grants-default is logged for all cohorts
// (including ineligible/unassigned) so the denominator captures every non-treatment assignment.
export function logBudgetServiceGrantsDefault(
  cohort: string | undefined,
  context: { siteId?: string; customerId?: string; subscriptionId?: string; reason?: string },
): void {
  logger.info('agent-token.bms-experiment-grants-default', {
    siteId: context.siteId,
    customerId: context.customerId,
    subscriptionId: context.subscriptionId,
    cohortId: cohort ?? 'none',
    reason: context.reason,
  });
}
