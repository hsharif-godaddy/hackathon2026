/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishDenialReason, PublishUpgradeRequiredError } from '@airo/shared/publish';
import { act } from '@testing-library/react';

import { usePublishForDomain } from '@/app/[market]/develop/components/settings/DomainPanel/usePublishForDomain';
import { logger } from '@/lib/request-context';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { createMockSite } from '@/tests/mocks';
import { renderHookWithProviders } from '@/tests/test-utils';

const mockMutateAsync = vi.fn();
const mockSetIsPublishing = vi.fn();
const mockSetPublishError = vi.fn();
const mockClearPublishStatus = vi.fn();

const mockDevelopState = {
  publishStates: {} as Record<string, { isPublishing: boolean; publishError: boolean }>,
  getPublishState: function getPublishState(appId: string) {
    return mockDevelopState.publishStates[appId] || {
      isPublishing: false,
      publishError: false,
      lastPublishedCommitHash: null,
      deploymentsRefetch: null,
    };
  },
  setIsPublishing: mockSetIsPublishing,
  setPublishError: mockSetPublishError,
  clearPublishStatus: mockClearPublishStatus,
};

const mockSite = createMockSite({
  id: 'app-123',
  agent_url: 'https://agent.test',
});

vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('@/hooks/usePublishComplianceGate', () => ({
  usePublishComplianceGate: () => ({ isBlocked: false }),
}));

vi.mock('@/hooks/useDeploymentsQuery', () => ({
  useDeploymentsQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsLoading: () => false,
  useStreamingState: () => 'idle',
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: typeof mockDevelopState) => unknown) => selector(mockDevelopState),
    { getState: () => mockDevelopState },
  ),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('usePublishForDomain', () => {
  beforeEach(function reset() {
    vi.clearAllMocks();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
    usePaywallStore.setState({ showUpgradeModal: false, paywallLoading: false });
  });

  it('suppresses publish error when upgrade modal is showing after paywall denial', async function suppressOnPaywall() {
    mockMutateAsync.mockRejectedValueOnce(
      new PublishUpgradeRequiredError(PublishDenialReason.NoSubscription, 'Publish not allowed'),
    );
    usePaywallStore.setState({ showUpgradeModal: true });

    const { result } = renderHookWithProviders(() => usePublishForDomain('app-123', mockSite));

    await act(async function publish() {
      await result.current.handlePublish();
    });

    expect(mockSetPublishError).not.toHaveBeenCalled();
    expect(mockSetIsPublishing).toHaveBeenCalledWith('app-123', false);
    expect(logger.error).toHaveBeenCalledWith('publish-for-domain.publish.error', {
      appId: 'app-123',
      error: 'Publish not allowed',
    });
  });

  it('sets publish error when upgrade modal is not showing after failure', async function showOnFailure() {
    mockMutateAsync.mockRejectedValueOnce(new Error('Server error'));
    usePaywallStore.setState({ showUpgradeModal: false });

    const { result } = renderHookWithProviders(() => usePublishForDomain('app-123', mockSite));

    await act(async function publish() {
      await result.current.handlePublish();
    });

    expect(mockSetPublishError).toHaveBeenCalledWith('app-123', true);
    expect(mockSetIsPublishing).toHaveBeenCalledWith('app-123', false);
    expect(logger.error).toHaveBeenCalledWith('publish-for-domain.publish.error', {
      appId: 'app-123',
      error: 'Server error',
    });
  });
});
