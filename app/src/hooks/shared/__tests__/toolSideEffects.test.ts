/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetQueryClient, mockInvalidateQueries, mockLogger } = vi.hoisted(() => ({
  mockGetQueryClient: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/app/[market]/develop/components/widgets/logo-utils', () => ({
  extractLogosFromToolResult: vi.fn(() => []),
  getLogoDisplayUrl: vi.fn(() => undefined),
}));

vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: mockGetQueryClient,
}));

vi.mock('@/hooks/shared/contextGatheringTracker', () => ({
  trackFromToolResult: vi.fn(),
}));

vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  trackHandoff: vi.fn(),
  trackQuestionReceived: vi.fn(),
}));

vi.mock('@/hooks/useBrandData', () => ({
  BRAND_DATA_UPDATED_EVENT: 'brand-data-updated',
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/stores/useCodeSyncStore', () => ({
  useCodeSyncStore: {
    getState: vi.fn(() => ({
      clearFileChange: vi.fn(),
      markFileComplete: vi.fn(),
      markFileStreaming: vi.fn(),
    })),
  },
}));

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      getSelectedCommitHash: vi.fn(() => null),
    })),
  },
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(() => ({
      activeStream: null,
      markUpstreamError: vi.fn(),
      messages: [],
      streamingState: 'idle',
    })),
  },
}));

vi.mock('@/stores/useTodoListStore', () => ({
  useTodoListStore: {
    getState: vi.fn(() => ({
      updateFromToolCall: vi.fn(),
    })),
  },
}));

vi.mock('@/stores/useUpfrontRebuildBuildQueueStore', () => ({
  useUpfrontRebuildBuildQueueStore: {
    getState: vi.fn(() => ({
      enqueue: vi.fn(),
      markProcessing: vi.fn(),
      setPlan: vi.fn(),
    })),
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  setInstrumentationBusinessName: vi.fn(),
  setInstrumentationIntentCategory: vi.fn(),
}));

vi.mock('@/utils/traffic-signals', () => ({
  readIntentCategoryFromSession: vi.fn(() => undefined),
}));

import { handleToolResultSideEffects } from '../toolSideEffects';

describe('toolSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockGetQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
    });
  });

  it('invalidates commerce binding after Commerce store setup completes', async () => {
    await handleToolResultSideEffects(
      {
        name: 'commerce__commerce_store_setup',
        output: {
          storeId: '339b8961-1860-48de-aa55-947634965c7a',
        },
      },
      'umsdd9ptiq'
    );

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['commerce-binding', 'umsdd9ptiq'],
      refetchType: 'active',
    });
  });

  it('invalidates commerce binding when store setup runs through execute_tool', async () => {
    await handleToolResultSideEffects(
      {
        name: 'commerce__execute_tool',
        input: {
          name: 'commerce_store_setup',
          arguments: { storePreference: 'existing' },
        },
        output: {
          storeId: '339b8961-1860-48de-aa55-947634965c7a',
        },
      },
      'umsdd9ptiq'
    );

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['commerce-binding', 'umsdd9ptiq'],
      refetchType: 'active',
    });
  });

  it('invalidates commerce binding after Commerce channel ensure completes', async () => {
    await handleToolResultSideEffects(
      {
        name: 'commerce__commerce_store_channel_ensure',
        output: {
          storeId: '339b8961-1860-48de-aa55-947634965c7a',
          channelId: '11111111-1111-4111-8111-111111111111',
        },
      },
      'umsdd9ptiq'
    );

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['commerce-binding', 'umsdd9ptiq'],
      refetchType: 'active',
    });
  });

  it('does not invalidate commerce binding for failed store setup', async () => {
    await handleToolResultSideEffects(
      {
        name: 'commerce__commerce_store_setup',
        error: 'setup failed',
      },
      'umsdd9ptiq'
    );

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('logs and continues when commerce binding invalidation fails', async () => {
    mockInvalidateQueries.mockRejectedValueOnce(new Error('query cache unavailable'));

    await expect(
      handleToolResultSideEffects(
        {
          name: 'commerceStoreSetup',
          output: {
            storeId: '339b8961-1860-48de-aa55-947634965c7a',
          },
        },
        'umsdd9ptiq'
      )
    ).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'toolSideEffects.commerceBinding.invalidateFailed',
      {
        appId: 'umsdd9ptiq',
        error: 'query cache unavailable',
      }
    );
  });
});
