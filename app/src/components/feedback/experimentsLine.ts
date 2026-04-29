import { useMemo } from 'react';

import { type HivemindExperiment, useGasketData } from '@/hooks/useGasketData';

// Cohort IDs Hivemind uses to indicate the user was not actually assigned to
// any experiment arm. Including these in the Slack payload is noise because
// the experiment had no effect on the session.
const NON_SIGNAL_COHORTS = new Set(['ineligible', 'unassigned', 'not_bucketed']);

function isHivemindAssignment(value: unknown): value is HivemindExperiment {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const cohortId = (value as { cohortId?: unknown }).cohortId;
  return (
    typeof cohortId === 'string'
    && cohortId.length > 0
    && !NON_SIGNAL_COHORTS.has(cohortId)
  );
}

export function buildExperimentsLineFromSwitchboard(switchboard: Record<string, unknown> | undefined): string {
  if (!switchboard) {
    return '';
  }
  const keys = Object.keys(switchboard).sort(function sortExperimentKeys(a, b) {
    return a.localeCompare(b, 'en');
  });
  const segments: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = switchboard[key];
    if (isHivemindAssignment(value)) {
      segments.push(`<https://hivemind.gdcorp.tools/experiments/${key}|${key}>: ${value.cohortId}`);
    }
  }
  return segments.join('\n');
}

export function useExperimentsLine(): string {
  const gasketData = useGasketData();
  return useMemo(
    function experimentsLineMemo() {
      return buildExperimentsLineFromSwitchboard(gasketData.switchboard as Record<string, unknown> | undefined);
    },
    [gasketData.switchboard],
  );
}
