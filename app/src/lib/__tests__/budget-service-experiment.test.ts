import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_IDS,
} from '@/config/experiments';
import {
  getBmsLaunchAACohort,
  normalizeHivemindCohort,
} from '@/lib/budget-service-experiment';

describe('budget-service-experiment', () => {
  describe('#normalizeHivemindCohort', function normalize() {
    it('returns flat string cohorts', function flatString() {
      expect(normalizeHivemindCohort('holdout')).toBe('holdout');
      expect(normalizeHivemindCohort('off')).toBe('off');
    });

    it('extracts cohortId from Hivemind experiment objects', function objectShape() {
      expect(normalizeHivemindCohort({ cohortId: 'holdout' })).toBe('holdout');
      expect(normalizeHivemindCohort({ cohortId: 'off' })).toBe('off');
    });

    it('returns undefined for invalid values', function invalid() {
      expect(normalizeHivemindCohort(undefined)).toBe(undefined);
      expect(normalizeHivemindCohort({})).toBe(undefined);
      expect(normalizeHivemindCohort({ cohortId: '' })).toBe(undefined);
    });
  });

  describe('#getBmsLaunchAACohort', function aacohort() {
    it('reads cohort from hivemind map for the A/A experiment', function readCohort() {
      expect(
        getBmsLaunchAACohort({ [EXPERIMENT_IDS.bmsLaunchAA]: 'bms' }),
      ).toBe('bms');
      expect(
        getBmsLaunchAACohort({ [EXPERIMENT_IDS.bmsLaunchAA]: { cohortId: 'grants' } }),
      ).toBe('grants');
    });

    it('returns undefined for missing or empty input', function missingKey() {
      expect(getBmsLaunchAACohort(undefined)).toBe(undefined);
      expect(getBmsLaunchAACohort({})).toBe(undefined);
    });
  });

});
