/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

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
const mockSetFirstPublishDeployPending = vi.fn();
const mockSetShowFirstPublishCongrats = vi.fn();
const mockFetchSite = vi.fn();
const mockFetchSitesList = vi.fn();
const mockHasBeenPublished = vi.fn();
const mockUseSwitchboard = vi.fn();

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
  setShowFirstPublishCongrats: mockSetShowFirstPublishCongrats,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: typeof mockDevelopState) => unknown) => selector(mockDevelopState),
    {
      getState: () => mockDevelopState,
      subscribe: vi.fn(() => () => {}),
    },
  ),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: (state: { fetchSite: typeof mockFetchSite }) => unknown) =>
    selector({ fetchSite: mockFetchSite }),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: (selector: (state: { fetchSite: typeof mockFetchSitesList }) => unknown) =>
    selector({ fetchSite: mockFetchSitesList }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: (...args: unknown[]) => mockHasBeenPublished(...args),
}));

describe('usePublishApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('includes dnsUpdateConsent=true in deployment payload', async () => {
    mockAppFetch.mockImplementation((url: string) => {
      if (url.includes('/deployments')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'failed to create deployment' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    mockAuthPreflight.mockResolvedValue(null);
    mockFetchAppDetails.mockResolvedValue({ id: 'app-123', variants: [] });
    mockGetConfigForSite.mockResolvedValue({ agentUrl: 'https://agent.test' });
    mockRegenerateToken.mockResolvedValue({ token: 'token-123' });
    mockIsPublishBlockedByComplianceRules.mockReturnValue(false);
    mockUseSwitchboard.mockReturnValue({ data: false });
    mockHasBeenPublished.mockReturnValue(false);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        commitHash: 'abc123',
        success: true,
      }),
    } as Response);

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
    mockAppFetch.mockImplementation((url: string) => {
      if (url.includes('/deployments')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'failed to create deployment' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    mockAuthPreflight.mockResolvedValue(null);
    mockFetchAppDetails.mockResolvedValue({ id: 'app-123', variants: [] });
    mockGetConfigForSite.mockResolvedValue({ agentUrl: 'https://agent.test' });
    mockRegenerateToken.mockResolvedValue({ token: 'token-123' });
    mockIsPublishBlockedByComplianceRules.mockReturnValue(false);
    mockUseSwitchboard.mockReturnValue({ data: false });
    mockHasBeenPublished.mockReturnValue(false);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        commitHash: 'abc123',
        success: true,
      }),
    } as Response);

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
    mockAppFetch.mockImplementation((url: string) => {
      if (url.includes('/deployments')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'failed to create deployment' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    mockAuthPreflight.mockResolvedValue(null);
    mockFetchAppDetails.mockResolvedValue({ id: 'app-123', variants: [] });
    mockGetConfigForSite.mockResolvedValue({ agentUrl: 'https://agent.test' });
    mockRegenerateToken.mockResolvedValue({ token: 'token-123' });
    mockIsPublishBlockedByComplianceRules.mockReturnValue(false);
    mockUseSwitchboard.mockReturnValue({ data: false });
    mockHasBeenPublished.mockReturnValue(false);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        commitHash: 'abc123',
        success: true,
      }),
    } as Response);

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
});
