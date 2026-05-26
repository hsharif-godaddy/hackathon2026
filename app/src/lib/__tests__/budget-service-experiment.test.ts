import { describe, expect, it } from 'vitest';

import {
  BUDGET_SERVICE_BMS_COHORT,
  BUDGET_SERVICE_GRANTS_COHORT,
  EXPERIMENT_IDS,
} from '@/config/experiments';
import {
  getBudgetServiceCohort,
  isBudgetServiceExperimentTreatment,
  normalizeHivemindCohort,
} from '@/lib/budget-service-experiment';

describe('budget-service-experiment', () => {
  describe('#normalizeHivemindCohort', function normalize() {
    it('returns flat string cohorts', function flatString() {
      expect(normalizeHivemindCohort('on')).toBe('on');
      expect(normalizeHivemindCohort('off')).toBe('off');
    });

    it('extracts cohortId from Hivemind experiment objects', function objectShape() {
      expect(normalizeHivemindCohort({ cohortId: 'on' })).toBe('on');
      expect(normalizeHivemindCohort({ cohortId: 'off' })).toBe('off');
    });

    it('returns undefined for invalid values', function invalid() {
      expect(normalizeHivemindCohort(undefined)).toBe(undefined);
      expect(normalizeHivemindCohort({})).toBe(undefined);
      expect(normalizeHivemindCohort({ cohortId: '' })).toBe(undefined);
    });
  });

  describe('#isBudgetServiceExperimentTreatment', function treatment() {
    it('returns false when switchboard flag is off', function flagOff() {
      expect(isBudgetServiceExperimentTreatment(false, 'on')).toBe(false);
      expect(isBudgetServiceExperimentTreatment(false, 'off')).toBe(false);
    });

    it('returns true only when switchboard is on and cohort is on', function onCohort() {
      expect(isBudgetServiceExperimentTreatment(true, 'on')).toBe(true);
    });

    it('returns false when switchboard is on but cohort is off', function offCohort() {
      expect(isBudgetServiceExperimentTreatment(true, 'off')).toBe(false);
    });

    it('returns false when switchboard is on but cohort is ineligible', function ineligible() {
      expect(isBudgetServiceExperimentTreatment(true, 'ineligible')).toBe(false);
    });

    it('returns false when switchboard is on but cohort is missing', function noCohort() {
      expect(isBudgetServiceExperimentTreatment(true, undefined)).toBe(false);
    });
  });

  describe('#getBudgetServiceCohort', function cohort() {
    it('reads on/off cohort from hivemind map (string or object)', function readCohort() {
      expect(
        getBudgetServiceCohort({ [EXPERIMENT_IDS.budgetService]: 'on' }),
      ).toBe(BUDGET_SERVICE_BMS_COHORT);
      expect(
        getBudgetServiceCohort({ [EXPERIMENT_IDS.budgetService]: { cohortId: 'off' } }),
      ).toBe(BUDGET_SERVICE_GRANTS_COHORT);
    });

    it('returns undefined for missing or empty input', function missingKey() {
      expect(getBudgetServiceCohort(undefined)).toBe(undefined);
      expect(getBudgetServiceCohort({})).toBe(undefined);
    });
  });
});
