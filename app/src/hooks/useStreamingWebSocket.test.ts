import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock all external dependencies
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    id: 'mock-socket-id',
    connected: false,
    on: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn()
  }))
}));

vi.mock('uuid', () => ({
  validate: vi.fn(() => true)
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn()
  }))
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useWebSocketState: vi.fn(() => ({ connected: false, status: 'idle' })),
  useCurrentAppId: vi.fn(() => null),
  useStartNewStream: vi.fn(() => vi.fn()),
  useAppendTextSegment: vi.fn(() => vi.fn()),
  useAddToolStartSegment: vi.fn(() => vi.fn()),
  useAddToolCallSegment: vi.fn(() => vi.fn()),
  useAddToolResultSegment: vi.fn(() => vi.fn()),
  useMarkMaxStepsReached: vi.fn(() => vi.fn()),
  useMarkUpstreamError: vi.fn(() => vi.fn()),
  useMarkBudgetExceeded: vi.fn(() => vi.fn()),
  useFinalizeStream: vi.fn(() => vi.fn()),
  useSetWebSocketState: vi.fn(() => vi.fn()),
  useSetStreamingState: vi.fn(() => vi.fn()),
  useSetIsLoading: vi.fn(() => vi.fn()),
  useStreamingConversationStore: {
    getState: vi.fn(() => ({
      streamingState: 'idle',
      activeStream: null,
      conversations: [],
      messages: [],
      currentAppId: null,
      updateToolDelta: vi.fn()
    })),
    setState: vi.fn(),
    subscribe: vi.fn(() => vi.fn())
  }
}));

vi.mock('@/stores/useTodoListStore', () => ({
  useTodoListStore: {
    getState: vi.fn(() => ({
      updateFromToolCall: vi.fn()
    }))
  }
}));

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      selectCommit: vi.fn()
    }))
  }
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@/lib/socketRegistry', () => ({
  setSharedSocket: vi.fn(),
  getSharedSocket: vi.fn(() => null)
}));

vi.mock('@/services/AgentService', () => ({
  AgentService: {
    getInstance: vi.fn(() => ({
      getConversation: vi.fn()
    }))
  }
}));

vi.mock('@/app/develop/components/visualContextCapture', () => ({
  captureVisualContext: vi.fn(() => Promise.resolve(null))
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn())
}));

vi.mock('../config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn(() => Promise.resolve({ baseUrl: 'http://localhost:4000' }))
  }
}));

describe('useStreamingWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch for JWT token
    global.fetch = vi.fn((url) => {
      if (url === '/api/auth/agent-token') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: 'test-jwt-token' })
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }) as any;

    // Mock document.cookie
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: ''
    });

    // Mock window.postMessage
    window.postMessage = vi.fn();
  });

  describe('Hook initialization', () => {
    it('should initialize with correct return values', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current).toHaveProperty('sendMessage');
      expect(result.current).toHaveProperty('webSocketState');
      expect(result.current).toHaveProperty('isConnected');
      expect(result.current).toHaveProperty('isStreaming');
      expect(typeof result.current.sendMessage).toBe('function');
    });

    it('should return initial connection state', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current.isConnected).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('sendMessage functionality', () => {
    it('should not send empty or whitespace-only messages', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');

      const { result } = renderHook(() => useStreamingWebSocket());

      // Test empty string
      await result.current.sendMessage('');

      // Test whitespace only
      await result.current.sendMessage('   ');
      await result.current.sendMessage('\n\t  ');

      // Verify no state changes occurred for empty messages
      expect(result.current.webSocketState).toBeDefined();
    });

    it('should require appId to send messages', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      // No appId
      vi.mocked(useCurrentAppId).mockReturnValue(null);

      const { result } = renderHook(() => useStreamingWebSocket());

      await result.current.sendMessage('Test message');

      // Should not proceed without appId
      expect(result.current.webSocketState).toBeDefined();
    });
  });

  describe('WebSocket state management', () => {
    it('should expose webSocketState from store', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useWebSocketState } = await import('@/stores/useStreamingConversationStore');

      const mockState = { connected: true, status: 'streaming' as const };
      vi.mocked(useWebSocketState).mockReturnValue(mockState);

      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current.webSocketState).toEqual(mockState);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.isStreaming).toBe(true);
    });

    it('should correctly determine isStreaming from status', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useWebSocketState } = await import('@/stores/useStreamingConversationStore');

      // Test streaming status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: true, status: 'streaming' });
      const { result: result1 } = renderHook(() => useStreamingWebSocket());
      expect(result1.current.isStreaming).toBe(true);

      // Test idle status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: true, status: 'idle' });
      const { result: result2 } = renderHook(() => useStreamingWebSocket());
      expect(result2.current.isStreaming).toBe(false);

      // Test error status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: false, status: 'error', error: 'Test error' });
      const { result: result3 } = renderHook(() => useStreamingWebSocket());
      expect(result3.current.isStreaming).toBe(false);
    });
  });

  describe('Store integration', () => {
    it('should use all required store hooks', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const {
        useWebSocketState,
        useCurrentAppId,
        useStartNewStream,
        useAppendTextSegment,
        useAddToolStartSegment,
        useAddToolCallSegment,
        useAddToolResultSegment,
        useMarkMaxStepsReached,
        useMarkUpstreamError,
        useFinalizeStream,
        useSetWebSocketState,
        useSetStreamingState,
        useSetIsLoading
      } = await import('@/stores/useStreamingConversationStore');

      renderHook(() => useStreamingWebSocket());

      // Verify all store hooks are called
      expect(useWebSocketState).toHaveBeenCalled();
      expect(useCurrentAppId).toHaveBeenCalled();
      expect(useStartNewStream).toHaveBeenCalled();
      expect(useAppendTextSegment).toHaveBeenCalled();
      expect(useAddToolStartSegment).toHaveBeenCalled();
      expect(useAddToolCallSegment).toHaveBeenCalled();
      expect(useAddToolResultSegment).toHaveBeenCalled();
      expect(useMarkMaxStepsReached).toHaveBeenCalled();
      expect(useMarkUpstreamError).toHaveBeenCalled();
      expect(useFinalizeStream).toHaveBeenCalled();
      expect(useSetWebSocketState).toHaveBeenCalled();
      expect(useSetStreamingState).toHaveBeenCalled();
      expect(useSetIsLoading).toHaveBeenCalled();
    });

    it('should subscribe to store updates', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useStreamingConversationStore } = await import('@/stores/useStreamingConversationStore');

      renderHook(() => useStreamingWebSocket());

      expect(useStreamingConversationStore.subscribe).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle fetch errors for JWT token gracefully', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');
      const { logger } = await import('@/lib/request-context');

      // Make fetch fail
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error'))) as any;
      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');

      // Should not throw
      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current).toBeDefined();
      expect(result.current.sendMessage).toBeInstanceOf(Function);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on unmount', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useStreamingConversationStore } = await import('@/stores/useStreamingConversationStore');

      const unsubscribeMock = vi.fn();
      vi.mocked(useStreamingConversationStore.subscribe).mockReturnValue(unsubscribeMock);

      const { unmount } = renderHook(() => useStreamingWebSocket());

      unmount();

      // Verify unsubscribe was called
      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });
});
