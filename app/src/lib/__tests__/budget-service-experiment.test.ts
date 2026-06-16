import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_IDS,
} from '@/config/experiments';
import {
  getBmsLaunchAACohort,
  getGrantsHoldoutCohort,
  isGrantsHoldoutParticipant,
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

  describe('#isGrantsHoldoutParticipant', function treatment() {
    it('returns true for any valid cohort (A/A — both arms use grants)', function validCohorts() {
      expect(isGrantsHoldoutParticipant('on')).toBe(true);
      expect(isGrantsHoldoutParticipant('off')).toBe(true);
    });

    it('returns false for excluded cohorts and undefined', function excluded() {
      expect(isGrantsHoldoutParticipant('ineligible')).toBe(false);
      expect(isGrantsHoldoutParticipant('unassigned')).toBe(false);
      expect(isGrantsHoldoutParticipant('not_bucketed')).toBe(false);
      expect(isGrantsHoldoutParticipant(undefined)).toBe(false);
    });

    it('returns false for unexpected cohort strings', function unexpected() {
      expect(isGrantsHoldoutParticipant('onn')).toBe(false);
      expect(isGrantsHoldoutParticipant('new_cohort')).toBe(false);
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

  describe('#getGrantsHoldoutCohort', function cohort() {
    it('reads cohort from hivemind map (string or object)', function readCohort() {
      expect(
        getGrantsHoldoutCohort({ [EXPERIMENT_IDS.grantsHoldout]: 'on' }),
      ).toBe('on');
      expect(
        getGrantsHoldoutCohort({ [EXPERIMENT_IDS.grantsHoldout]: { cohortId: 'off' } }),
      ).toBe('off');
    });

    it('returns undefined for missing or empty input', function missingKey() {
      expect(getGrantsHoldoutCohort(undefined)).toBe(undefined);
      expect(getGrantsHoldoutCohort({})).toBe(undefined);
    });
  });
});
