import { type HivemindExperiment, useGasketData } from './useGasketData';

/**
 * Hook to access Hivemind experiment cohort assignments
 *
 * Uses gasketData populated by @godaddy/gasket-plugin-switchboard.
 * Experiments are fetched server-side and made available to the client
 * via the switchboard.enableGasketData configuration.
 *
 * @param experimentId - Hivemind experiment ID to access
 * @returns Experiment cohort data
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { cohort, data } = useHivemind('my-experiment');
 * if (cohort === 'treatment') {
 *   return <NewFeature data={data} />;
 * }
 * return <OldFeature />;
 * ```
 */
export function useHivemind(experimentId: string): {
  cohort: string | undefined;
  data: Record<string, unknown> | undefined;
  experiment: HivemindExperiment | undefined;
} {
  const gasketData = useGasketData();
  const experiment = gasketData.switchboard?.[experimentId] as HivemindExperiment | undefined;

  return {
    cohort: experiment?.cohortId,
    data: experiment?.data,
    experiment,
  };
}

/**
 * Hook to check if user is in a specific cohort for an experiment
 *
 * Convenience wrapper around useHivemind for simple cohort checks.
 *
 * @param experimentId - Hivemind experiment ID
 * @param cohortId - Cohort ID to check (e.g., 'treatment', 'control')
 * @returns Boolean indicating if user is in the specified cohort
 *
 * @example
 * ```typescript
 * const isInTreatment = useIsInCohort('my-experiment', 'treatment');
 * if (isInTreatment) {
 *   return <NewFeature />;
 * }
 * return <OldFeature />;
 * ```
 */
export function useIsInCohort(experimentId: string, cohortId: string): boolean {
  const { cohort } = useHivemind(experimentId);
  return cohort === cohortId;
}

/**
 * Hook to get all experiment cohorts from gasketData
 *
 * Returns all Hivemind experiments that were fetched server-side.
 * Useful for debugging or when you need access to multiple experiments.
 *
 * @returns Record of experiment IDs to cohort assignments
 *
 * @example
 * ```typescript
 * const cohorts = useExperimentCohorts();
 * console.log('User cohorts:', cohorts);
 * // { 'experiment-a': { cohortId: 'treatment', data: {...} }, ... }
 * ```
 */
export function useExperimentCohorts(): Record<string, HivemindExperiment> {
  const gasketData = useGasketData();
  return (gasketData.switchboard || {}) as Record<string, HivemindExperiment>;
}
