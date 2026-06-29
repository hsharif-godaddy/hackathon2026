import type { NextRequest } from 'next/server';

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments';
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

/**
 * Extract the BMS A/A experiment cohort from a Hivemind cohort map (homepage users only).
 */
export function getBmsLaunchAACohort(
  hivemindCohorts: Record<string, unknown> | undefined,
): string | undefined {
  return normalizeHivemindCohort(hivemindCohorts?.[EXPERIMENT_IDS.bmsLaunchAA]);
}

export function logBmsLaunchAATriggered(
  cohort: string | undefined,
  context: { customerId?: string },
): void {
  if (!cohort || EXCLUDED_COHORTS.has(cohort)) return;
  logger.info('hivemind.experiment.triggered', {
    experimentId: EXPERIMENT_IDS.bmsLaunchAA,
    cohortId: cohort,
    customerId: context.customerId,
  });
}

