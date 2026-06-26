import { describe, expect, it } from 'vitest';

import type { SiteInfo } from '@/lib/control-plane/types';
import { SubscriptionPlan } from '@/types/credits';
import {
  canPublishWithPlan,
  evaluatePublishLimit,
  filterPublishedApps,
  getPublishLimit,
  isPublishedApp,
  PLAN_PUBLISH_LIMITS,
} from './index';

/** Build a minimal published-apps list for limit tests. */
const mkApps = (ids: string[]): SiteInfo[] =>
  ids.map(id => ({ id })) as unknown as SiteInfo[];

/** Defaults for evaluatePublishLimit inputs; override per test. */
const baseInputs = {
  subscriptionPlan: undefined as SubscriptionPlan | undefined,
  hadAiroPlus: false,
  publishedApps: [] as SiteInfo[],
  publishedCount: 0,
  currentAppId: undefined as string | undefined,
  isBypassEnabled: false,
  isPublishedAppsLoading: false,
};

describe('publish-limit', () => {
  describe('PLAN_PUBLISH_LIMITS', () => {
    it('should have correct limits for all plans', () => {
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.None]).toBe(0);
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.Free]).toBe(0);
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.Starter]).toBe(1);
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.Professional]).toBe(10);
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.Ultimate]).toBe(50);
      expect(PLAN_PUBLISH_LIMITS[SubscriptionPlan.AiroPlus]).toBe(9);
    });

    it('should have entries for all subscription plans', () => {
      const planValues = Object.values(SubscriptionPlan) as SubscriptionPlan[];
      planValues.forEach(plan => {
        expect(PLAN_PUBLISH_LIMITS).toHaveProperty(plan);
      });
    });
  });

  describe('getPublishLimit', () => {
    it('should return correct limit for each plan', () => {
      expect(getPublishLimit(SubscriptionPlan.None)).toBe(0);
      expect(getPublishLimit(SubscriptionPlan.Free)).toBe(0);
      expect(getPublishLimit(SubscriptionPlan.Starter)).toBe(1);
      expect(getPublishLimit(SubscriptionPlan.Professional)).toBe(10);
      expect(getPublishLimit(SubscriptionPlan.Ultimate)).toBe(50);
      expect(getPublishLimit(SubscriptionPlan.AiroPlus)).toBe(9);
    });

    it('should return 0 for undefined plan', () => {
      expect(getPublishLimit(undefined)).toBe(0);
    });
  });

  describe('isPublishedApp', () => {
    describe('V2 variantsWithLifecycle format', () => {
      it('should return true for active publish variant', () => {
        const app = {
          variantsWithLifecycle: [
            { variant: 'publish', status: 'active' },
          ],
        };
        expect(isPublishedApp(app)).toBe(true);
      });

      it('should return false for inactive publish variant', () => {
        const app = {
          variantsWithLifecycle: [
            { variant: 'publish', status: 'inactive' },
          ],
        };
        expect(isPublishedApp(app)).toBe(false);
      });

      it('should return false for non-publish variant', () => {
        const app = {
          variantsWithLifecycle: [
            { variant: 'draft', status: 'active' },
          ],
        };
        expect(isPublishedApp(app)).toBe(false);
      });

      it('should return true when publish is among multiple variants', () => {
        const app = {
          variantsWithLifecycle: [
            { variant: 'draft', status: 'active' },
            { variant: 'publish', status: 'active' },
            { variant: 'preview', status: 'inactive' },
          ],
        };
        expect(isPublishedApp(app)).toBe(true);
      });

      it('should return false for empty variantsWithLifecycle', () => {
        const app = {
          variantsWithLifecycle: [],
        };
        expect(isPublishedApp(app)).toBe(false);
      });
    });

    describe('Legacy variants format', () => {
      it('should return true when variants includes publish', () => {
        const app = {
          variants: ['draft', 'publish'],
        };
        expect(isPublishedApp(app)).toBe(true);
      });

      it('should return false when variants does not include publish', () => {
        const app = {
          variants: ['draft', 'preview'],
        };
        expect(isPublishedApp(app)).toBe(false);
      });

      it('should return false for empty variants', () => {
        const app = {
          variants: [],
        };
        expect(isPublishedApp(app)).toBe(false);
      });
    });

    it('should prefer V2 format over legacy', () => {
      // V2 says not published, legacy says published - V2 should win
      const app = {
        variantsWithLifecycle: [
          { variant: 'publish', status: 'inactive' },
        ],
        variants: ['publish'],
      };
      expect(isPublishedApp(app)).toBe(false);
    });

    it('should return false when no variants info available', () => {
      const app = {};
      expect(isPublishedApp(app)).toBe(false);
    });
  });

  describe('filterPublishedApps', () => {
    it('should filter to only published apps (V2)', () => {
      const apps = [
        { id: '1', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
        { id: '2', variantsWithLifecycle: [{ variant: 'draft', status: 'active' }] },
        { id: '3', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
      ];

      const published = filterPublishedApps(apps);

      expect(published).toHaveLength(2);
      expect(published.map(a => a.id)).toEqual(['1', '3']);
    });

    it('should filter to only published apps (legacy)', () => {
      const apps = [
        { id: '1', variants: ['publish'] },
        { id: '2', variants: ['draft'] },
        { id: '3', variants: ['draft', 'publish'] },
      ];

      const published = filterPublishedApps(apps);

      expect(published).toHaveLength(2);
      expect(published.map(a => a.id)).toEqual(['1', '3']);
    });

    it('should return empty array when no published apps', () => {
      const apps = [
        { id: '1', variantsWithLifecycle: [{ variant: 'draft', status: 'active' }] },
        { id: '2', variantsWithLifecycle: [{ variant: 'preview', status: 'active' }] },
      ];

      const published = filterPublishedApps(apps);

      expect(published).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      expect(filterPublishedApps([])).toEqual([]);
    });
  });

  describe('canPublishWithPlan', () => {
    describe('AiroPlus plan (limit: 9 apps for legacy users)', () => {
      it('should allow when under limit', () => {
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 0)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 5)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 8)).toBe(true);
      });

      it('should deny when at limit (9 published)', () => {
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 9)).toBe(false);
      });

      it('should deny when over limit', () => {
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 10)).toBe(false);
        expect(canPublishWithPlan(SubscriptionPlan.AiroPlus, 100)).toBe(false);
      });

      it('should allow re-publishing existing app even at limit', () => {
        const publishedAppIds = Array.from({ length: 9 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.AiroPlus,
          9,
          'app-5', // Re-publish existing
          publishedAppIds
        )).toBe(true);
      });

      it('should deny new app when at limit', () => {
        const publishedAppIds = Array.from({ length: 9 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.AiroPlus,
          9,
          'app-new',
          publishedAppIds
        )).toBe(false);
      });
    });

    describe('No publishing allowed (Free, None)', () => {
      it('should never allow publishing for Free plan', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Free, 0)).toBe(false);
        expect(canPublishWithPlan(SubscriptionPlan.Free, 0, 'app-1', [])).toBe(false);
      });

      it('should never allow publishing for None plan', () => {
        expect(canPublishWithPlan(SubscriptionPlan.None, 0)).toBe(false);
        expect(canPublishWithPlan(SubscriptionPlan.None, 0, 'app-1', [])).toBe(false);
      });

      it('should not allow publishing for undefined plan', () => {
        expect(canPublishWithPlan(undefined, 0)).toBe(false);
      });
    });

    describe('Starter plan (limit: 1)', () => {
      it('should allow when under limit (0 published)', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 0)).toBe(true);
      });

      it('should deny when at limit (1 published)', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 1)).toBe(false);
      });

      it('should deny when over limit', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 2)).toBe(false);
      });

      it('should allow re-publishing existing app even at limit', () => {
        expect(canPublishWithPlan(
          SubscriptionPlan.Starter,
          1,
          'app-existing',
          ['app-existing']
        )).toBe(true);
      });

      it('should deny new app when at limit', () => {
        expect(canPublishWithPlan(
          SubscriptionPlan.Starter,
          1,
          'app-new',
          ['app-existing']
        )).toBe(false);
      });
    });

    describe('Professional plan (limit: 10)', () => {
      it('should allow when under limit', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Professional, 0)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Professional, 5)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Professional, 9)).toBe(true);
      });

      it('should deny when at limit (10 published)', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Professional, 10)).toBe(false);
      });

      it('should allow re-publishing existing app even at limit', () => {
        const publishedAppIds = Array.from({ length: 10 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.Professional,
          10,
          'app-5',
          publishedAppIds
        )).toBe(true);
      });

      it('should deny new app when at limit', () => {
        const publishedAppIds = Array.from({ length: 10 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.Professional,
          10,
          'app-new',
          publishedAppIds
        )).toBe(false);
      });
    });

    describe('Ultimate plan (limit: 50)', () => {
      it('should allow when under limit', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Ultimate, 0)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Ultimate, 25)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Ultimate, 49)).toBe(true);
      });

      it('should deny when at limit (50 published)', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Ultimate, 50)).toBe(false);
      });

      it('should allow re-publishing existing app even at limit', () => {
        const publishedAppIds = Array.from({ length: 50 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.Ultimate,
          50,
          'app-25', // Re-publish existing
          publishedAppIds
        )).toBe(true);
      });

      it('should deny new app when at limit', () => {
        const publishedAppIds = Array.from({ length: 50 }, (_, i) => `app-${i}`);
        expect(canPublishWithPlan(
          SubscriptionPlan.Ultimate,
          50,
          'app-new',
          publishedAppIds
        )).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle undefined currentAppId', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 0, undefined)).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 1, undefined)).toBe(false);
      });

      it('should handle undefined publishedAppIds', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 0, 'app-1')).toBe(true);
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 1, 'app-1')).toBe(false);
      });

      it('should handle empty publishedAppIds array', () => {
        expect(canPublishWithPlan(SubscriptionPlan.Starter, 0, 'app-1', [])).toBe(true);
      });
    });
  });

  describe('evaluatePublishLimit', () => {
    it('allows publishing when bypass flag is enabled, regardless of plan', () => {
      const result = evaluatePublishLimit({ ...baseInputs, isBypassEnabled: true });
      expect(result.canPublish).toBe(true);
      expect(result.limit).toBeNull();
    });

    it('denies (without limit:0) while published apps are still loading', () => {
      const result = evaluatePublishLimit({
        ...baseInputs,
        subscriptionPlan: SubscriptionPlan.Ultimate,
        isPublishedAppsLoading: true,
      });
      expect(result.canPublish).toBe(false);
      expect(result.limit).toBeNull();
    });

    it('treats an undefined plan as free (limit:0, paywall)', () => {
      const result = evaluatePublishLimit({ ...baseInputs, subscriptionPlan: undefined });
      expect(result.canPublish).toBe(false);
      expect(result.limit).toBe(0);
    });

    it('treats Free and None plans as limit:0', () => {
      expect(evaluatePublishLimit({ ...baseInputs, subscriptionPlan: SubscriptionPlan.Free }).limit).toBe(0);
      expect(evaluatePublishLimit({ ...baseInputs, subscriptionPlan: SubscriptionPlan.None }).limit).toBe(0);
    });

    it('allows a paid plan under its limit', () => {
      const result = evaluatePublishLimit({
        ...baseInputs,
        subscriptionPlan: SubscriptionPlan.Ultimate,
        publishedCount: 3,
      });
      expect(result.canPublish).toBe(true);
      expect(result.limit).toBe(50);
      expect(result.plan).toBe(SubscriptionPlan.Ultimate);
    });

    it('denies a paid plan at its limit (limit > 0 → publish-limit modal path)', () => {
      const result = evaluatePublishLimit({
        ...baseInputs,
        subscriptionPlan: SubscriptionPlan.Starter,
        publishedApps: mkApps(['other-app']),
        publishedCount: 1,
      });
      expect(result.canPublish).toBe(false);
      expect(result.limit).toBe(1);
    });

    it('allows re-publishing an already-published app without consuming a slot', () => {
      const result = evaluatePublishLimit({
        ...baseInputs,
        subscriptionPlan: SubscriptionPlan.Starter,
        publishedApps: mkApps(['app-1']),
        publishedCount: 1,
        currentAppId: 'app-1',
      });
      expect(result.canPublish).toBe(true);
    });

    it('maps legacy Airo Plus (Starter + hadAiroPlus) to the AiroPlus limit of 9', () => {
      const result = evaluatePublishLimit({
        ...baseInputs,
        subscriptionPlan: SubscriptionPlan.Starter,
        hadAiroPlus: true,
        publishedCount: 5,
      });
      expect(result.plan).toBe(SubscriptionPlan.AiroPlus);
      expect(result.limit).toBe(9);
      expect(result.canPublish).toBe(true);
    });
  });
});
