/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorCode } from '@airo/shared/api-error-code';
import { PublishUpgradeRequiredError } from '@airo/shared/publish';
import { act } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderHookWithProviders } from '@/tests/test-utils';
import { usePublishApp } from './usePublishApp';

const mockAppFetch = vi.fn();
const mockAuthPreflight = vi.fn();
const mockRegenerateToken = vi.fn();
const mockGetConfigForSite = vi.fn();
const mockFetchAppDetails = vi.fn();
const mockIsPublishBlockedByComplianceRules = vi.fn();
const mockGetPublishComplianceBlockReason = vi.fn();
const mockSetLastPublishedCommitHash = vi.fn();
const mockSetDeploymentInProgressId = vi.fn();
const mockSetBuildErrorDetails = vi.fn();
const mockSetIsPublishing = vi.fn();
const mockSetPublishSuccess = vi.fn();
const mockSetShowPaywallModal = vi.fn();
const mockSetFirstPublishDeployPending = vi.fn();
const mockSetShowFirstPublishCongrats = vi.fn();
const mockFetchSite = vi.fn();
const mockFetchSitesList = vi.fn();
const mockHasBeenPublished = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockOpenUpgradeModal = vi.fn();
const mockPaywallState = {
  showUpgradeModal: false,
  openUpgradeModal: vi.fn(function (_source: string, _itc?: string) {
    mockPaywallState.showUpgradeModal = true;
    mockOpenUpgradeModal(_source, _itc);
  }),
};

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: (...args: unknown[]) => mockGetConfigForSite(...args),
  },
}));

vi.mock('@/hooks/useAppDetails', () => ({
  appDetailsQueryKey: (appId: string) => ['app-details', appId],
  fetchAppDetails: (...args: unknown[]) => mockFetchAppDetails(...args),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (...args: unknown[]) => mockUseSwitchboard(...args),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/gasket-config', () => ({
  AuthDismissedError: class AuthDismissedError extends Error {},
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  authPreflight: (...args: unknown[]) => mockAuthPreflight(...args),
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: (...args: unknown[]) => mockRegenerateToken(...args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/subscription', () => ({
  PublishComplianceBlockReason: {
    SiteSuspended: 'site-suspended',
  },
  getPublishComplianceBlockReason: (...args: unknown[]) => mockGetPublishComplianceBlockReason(...args),
  isPublishBlockedByComplianceRules: (...args: unknown[]) => mockIsPublishBlockedByComplianceRules(...args),
}));

const mockDevelopState = {
  setBuildErrorDetails: mockSetBuildErrorDetails,
  setDeploymentInProgressId: mockSetDeploymentInProgressId,
  setFirstPublishDeployPending: mockSetFirstPublishDeployPending,
  setIsPublishing: mockSetIsPublishing,
  setLastPublishedCommitHash: mockSetLastPublishedCommitHash,
  setPublishSuccess: mockSetPublishSuccess,
  setShowPaywallModal: mockSetShowPaywallModal,
  setShowFirstPublishCongrats: mockSetShowFirstPublishCongrats,
  publishStates: {} as Record<string, any>,
  getPublishState: (appId: string) => mockDevelopState.publishStates[appId] || {},
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: typeof mockDevelopState) => unknown) => selector(mockDevelopState),
    {
      getState: () => mockDevelopState,
      subscribe: vi.fn(function () { return () => {}; }),
    },
  ),
}));

const mockSiteStoreState = {
  fetchSite: mockFetchSite,
  getSite: () => ({ published_url: null }),
};
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: Object.assign(
    (selector: (state: typeof mockSiteStoreState) => unknown) => selector(mockSiteStoreState),
    { getState: () => mockSiteStoreState },
  ),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: (selector: (state: { fetchSite: typeof mockFetchSitesList }) => unknown) =>
    selector({ fetchSite: mockFetchSitesList }),
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: {
    getState: () => mockPaywallState,
  },
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: (...args: unknown[]) => mockHasBeenPublished(...args),
}));

const mockPollPublishStatus = vi.fn();
vi.mock('@/lib/publish-polling', () => ({
  pollPublishStatus: (...args: unknown[]) => mockPollPublishStatus(...args),
}));

describe('usePublishApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockPaywallState.showUpgradeModal = false;
  });

  function setupMocks() {
    mockAuthPreflight.mockResolvedValue(null);
    mockFetchAppDetails.mockResolvedValue({ id: 'app-123', variants: [] });
    mockGetConfigForSite.mockResolvedValue({ agentUrl: 'https://agent.test' });
    mockRegenerateToken.mockResolvedValue({ token: 'token-123' });
    mockIsPublishBlockedByComplianceRules.mockReturnValue(false);
    mockUseSwitchboard.mockReturnValue(true);
    mockHasBeenPublished.mockReturnValue(false);
    mockPollPublishStatus.mockResolvedValue({ phase: 'deployed', commitHash: 'abc123', version: 'v1' });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'pub_1', phase: 'building' }),
    } as Response);
  }

  it('includes dnsUpdateConsent=true in deployment payload', async () => {
    setupMocks();
    mockAppFetch.mockImplementation(function (url: string) {
      if (url.includes('/deployments')) {
        return Promise.resolve({ ok: true, json: async () => ({ deploymentId: 'dep-1', status: 'deploying' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await act(async () => {
      await result.current.mutateAsync({ appId: 'app-123', dnsUpdateConsent: true });
    });

    const deploymentCall = mockAppFetch.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('/deployments'),
    );
    expect(deploymentCall).toBeDefined();
    const deploymentBody = JSON.parse((deploymentCall?.[1] as RequestInit).body as string);
    expect(deploymentBody).toEqual({
      gitHash: 'abc123',
      dnsUpdateConsent: true,
    });
  });

  it('omits dnsUpdateConsent when it is undefined', async () => {
    setupMocks();
    mockAppFetch.mockImplementation(function (url: string) {
      if (url.includes('/deployments')) {
        return Promise.resolve({ ok: true, json: async () => ({ deploymentId: 'dep-1', status: 'deploying' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await act(async () => {
      await result.current.mutateAsync({ appId: 'app-123' });
    });

    const deploymentCall = mockAppFetch.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('/deployments'),
    );
    expect(deploymentCall).toBeDefined();
    const deploymentBody = JSON.parse((deploymentCall?.[1] as RequestInit).body as string);
    expect(deploymentBody).toEqual({
      gitHash: 'abc123',
    });
  });

  it('includes dnsUpdateConsent=false in deployment payload', async () => {
    setupMocks();
    mockAppFetch.mockImplementation(function (url: string) {
      if (url.includes('/deployments')) {
        return Promise.resolve({ ok: true, json: async () => ({ deploymentId: 'dep-1', status: 'deploying' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await act(async () => {
      await result.current.mutateAsync({ appId: 'app-123', dnsUpdateConsent: false });
    });

    const deploymentCall = mockAppFetch.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('/deployments'),
    );
    expect(deploymentCall).toBeDefined();
    const deploymentBody = JSON.parse((deploymentCall?.[1] as RequestInit).body as string);
    expect(deploymentBody).toEqual({
      gitHash: 'abc123',
      dnsUpdateConsent: false,
    });
  });

  it('throws on poll phase=failed with build error details', async () => {
    setupMocks();
    mockPollPublishStatus.mockResolvedValue({
      phase: 'failed',
      error: 'Build script exited with code 1',
      logs: ['ERR: missing dependency'],
    });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toThrow('Build script exited with code 1');

    expect(mockSetBuildErrorDetails).toHaveBeenCalledWith('app-123', {
      error: 'Build script exited with code 1',
      details: 'ERR: missing dependency',
    });
  });

  it('throws on poll phase=timeout', async () => {
    setupMocks();
    mockPollPublishStatus.mockResolvedValue({ phase: 'timeout' });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toThrow('Publish may have failed');
  });

  it('throws on poll phase=aborted', async () => {
    setupMocks();
    mockPollPublishStatus.mockResolvedValue({ phase: 'aborted' });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toThrow('Publish polling was cancelled');
  });

  it('throws when deployed without commitHash', async () => {
    setupMocks();
    mockPollPublishStatus.mockResolvedValue({ phase: 'deployed', commitHash: undefined });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toThrow('Publish succeeded but no commit hash returned');
  });

  it('returns immediately on local-dev sync response (published: true)', async () => {
    setupMocks();
    mockUseSwitchboard.mockReturnValue(false);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ published: true, commitHash: 'local-abc' }),
    } as Response);

    const { result } = renderHookWithProviders(() => usePublishApp());

    let data: any;
    await act(async () => {
      data = await result.current.mutateAsync({ appId: 'app-123' });
    });

    expect(data.commitHash).toBe('local-abc');
    expect(mockPollPublishStatus).not.toHaveBeenCalled();
  });

  it('opens upgrade modal on 403 PERMISSION_DENIED from agents', async function permissionDenied() {
    setupMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'Publish not allowed',
        details: 'Publishing requires a paid Airo Builder plan',
        code: ApiErrorCode.PermissionDenied,
      }),
    } as Response);

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toBeInstanceOf(PublishUpgradeRequiredError);

    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish', PAYWALL_ITC.PUBLISH);
    expect(mockSetIsPublishing).toHaveBeenCalledWith('app-123', false);
    expect(mockSetBuildErrorDetails).not.toHaveBeenCalled();
  });

  it('still throws PublishUpgradeRequiredError when paywall store update fails', async function storeFailure() {
    setupMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'Publish not allowed',
        details: 'Publishing requires a paid Airo Builder plan',
        code: ApiErrorCode.PermissionDenied,
      }),
    } as Response);
    mockSetIsPublishing.mockImplementation(function () {
      throw new Error('store failed');
    });

    const { result } = renderHookWithProviders(() => usePublishApp());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ appId: 'app-123' });
      }),
    ).rejects.toBeInstanceOf(PublishUpgradeRequiredError);
  });
});
