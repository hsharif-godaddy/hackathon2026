/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useUpgradeBannerExperiment } from './useUpgradeBannerExperiment';

const mockUseSwitchboard = vi.fn(function () { return true; });
const mockUseHivemind = vi.fn(function () { return { cohort: 'off' }; });
const mockUsePaywallEligibility = vi.fn(function () { return { showPaywall: true }; });
const mockUseSiteStore = vi.fn(function (selector: any) {
  return selector({ getSite: () => ({ sharedWithMe: false, agent_url: 'http://agent' }) });
});
const mockUseDevelopPageStore = vi.fn(function (selector: any) {
  return selector({ app: { id: 'app-1', initialBuildComplete: true } });
});
const mockLogImpressionEvent = vi.fn(function () { return vi.fn(); });
const mockUseGitHistoryQuery = vi.fn(function () {
  return { data: { commits: [{ hash: '1' }, { hash: '2' }], currentCommit: '2', hasMore: false } };
});

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'app-1'; }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (...args: any[]) => mockUseSwitchboard(...args),
}));

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: (...args: any[]) => mockUseHivemind(...args),
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: (...args: any[]) => mockUsePaywallEligibility(...args),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => mockUseSiteStore(selector),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => mockUseDevelopPageStore(selector),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: (...args: any[]) => mockUseGitHistoryQuery(...args),
  GitHistoryQueryResult: {},
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (...args: any[]) => mockLogImpressionEvent(...args),
}));

vi.mock('@/config/experiments', () => ({
  COHORT_ON: 'on',
  EXPERIMENT_IDS: { upgradeBannerPlacement: 'aab-upgrade-banner-placement' },
}));

// Wrapper to satisfy eslint react-hooks/rules-of-hooks inside renderHook
function useHookUnderTest() {
  return useUpgradeBannerExperiment();
}

describe('useUpgradeBannerExperiment', function useUpgradeBannerExperimentTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
    vi.resetModules();
    mockUseSwitchboard.mockReturnValue(true);
    mockUseHivemind.mockReturnValue({ cohort: 'off' });
    mockUsePaywallEligibility.mockReturnValue({ showPaywall: true });
    mockUseSiteStore.mockImplementation(function (selector: any) {
      return selector({ getSite: () => ({ sharedWithMe: false, agent_url: 'http://agent' }) });
    });
    mockUseDevelopPageStore.mockImplementation(function (selector: any) {
      return selector({ app: { id: 'app-1', initialBuildComplete: true } });
    });
    mockUseGitHistoryQuery.mockReturnValue({
      data: { commits: [{ hash: '1' }, { hash: '2' }], currentCommit: '2', hasMore: false },
    });
  });

  describe('cohort routing', function cohortRoutingTests() {
    it('should return showChatBanner=true for off cohort (control)', function controlCohort() {
      mockUseHivemind.mockReturnValue({ cohort: 'off' });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(true);
      expect(result.current.showPreviewBar).toBe(false);
    });

    it('should return showPreviewBar=true for on cohort (treatment)', function treatmentCohort() {
      mockUseHivemind.mockReturnValue({ cohort: 'on' });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showPreviewBar).toBe(true);
      expect(result.current.showChatBanner).toBe(false);
    });

    it('should return showChatBanner=true for undefined cohort (ineligible)', function ineligibleCohort() {
      mockUseHivemind.mockReturnValue({ cohort: undefined });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(true);
      expect(result.current.showPreviewBar).toBe(false);
    });
  });

  describe('eligibility gates', function eligibilityGateTests() {
    it('should hide when feature flag is disabled', function flagDisabled() {
      mockUseSwitchboard.mockReturnValue(false);

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(false);
      expect(result.current.showPreviewBar).toBe(false);
    });

    it('should hide when user is not free (showPaywall=false)', function paidUser() {
      mockUsePaywallEligibility.mockReturnValue({ showPaywall: false });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(false);
      expect(result.current.showPreviewBar).toBe(false);
    });

    it('should hide for shared/invited users', function sharedUser() {
      mockUseSiteStore.mockImplementation(function (selector: any) {
        return selector({ getSite: () => ({ sharedWithMe: true, agent_url: 'http://agent' }) });
      });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(false);
      expect(result.current.showPreviewBar).toBe(false);
    });

    it('should hide when app has not been built (no commits, initialBuildComplete=false)', function notBuilt() {
      mockUseDevelopPageStore.mockImplementation(function (selector: any) {
        return selector({ app: { id: 'app-1', initialBuildComplete: false } });
      });
      mockUseGitHistoryQuery.mockReturnValue({ data: { commits: [{ hash: '1' }], currentCommit: '1', hasMore: false } });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(false);
      expect(result.current.showPreviewBar).toBe(false);
    });

    it('should show when initialBuildComplete=true even with fewer than 2 commits', function initialBuildCompleteSignal() {
      mockUseDevelopPageStore.mockImplementation(function (selector: any) {
        return selector({ app: { id: 'app-1', initialBuildComplete: true } });
      });
      mockUseGitHistoryQuery.mockReturnValue({ data: { commits: [{ hash: '1' }], currentCommit: '1', hasMore: false } });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(true);
    });

    it('should show when 2+ commits exist even with initialBuildComplete=false', function commitCountSignal() {
      mockUseDevelopPageStore.mockImplementation(function (selector: any) {
        return selector({ app: { id: 'app-1', initialBuildComplete: false } });
      });
      mockUseGitHistoryQuery.mockReturnValue({
        data: { commits: [{ hash: '1' }, { hash: '2' }, { hash: '3' }], currentCommit: '3', hasMore: false },
      });

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(true);
    });

    it('should hide when dismissed today', function dismissedToday() {
      const today: string = new Date().toLocaleDateString('en-CA');
      localStorage.setItem('airoplus_upgrade_banner_dismissed', today);

      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(false);
      expect(result.current.showPreviewBar).toBe(false);
    });
  });

  describe('dismiss', function dismissTests() {
    it('should write to localStorage and hide banner', function dismissPersists() {
      const { result } = renderHook(useHookUnderTest);

      expect(result.current.showChatBanner).toBe(true);

      result.current.dismiss();

      expect(localStorage.getItem('airoplus_upgrade_banner_dismissed')).toBe(
        new Date().toLocaleDateString('en-CA')
      );
    });
  });
});
