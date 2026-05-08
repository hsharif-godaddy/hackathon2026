/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  cancelDeferredRegistryDestroy,
  clearController,
  getController,
} from '@/services/websocket/controllerRegistry';

const mockSetWebSocketState = vi.fn()
const mockSetError = vi.fn()
const mockMarkUpstreamErrorAction = vi.fn()

const mockSetIsLoadingAction = vi.fn()

const mockAppendTextSegment = vi.fn()
const mockStartNewStream = vi.fn()
const mockAddToolStartSegment = vi.fn()
const mockAddToolCallSegment = vi.fn()
const mockAddToolResultSegment = vi.fn()
const mockMarkMaxStepsReached = vi.fn()
const mockMarkBudgetExceeded = vi.fn()
const mockFinalizeStream = vi.fn()

const createStreamingStoreState = () => ({
  streamingState: 'idle',
  activeStream: null,
  conversations: [],
  messages: [],
  currentAppId: null,
  updateToolDelta: vi.fn(),
  connectionRetry: {
    isRetrying: false,
    retryStartedAt: null,
    wasStreamingOnDisconnect: false,
    disconnectSocketId: null,
    escalationTimeoutId: null
  },
  startConnectionRetry: vi.fn(),
  setEscalationTimeout: vi.fn(),
  clearConnectionRetry: vi.fn(),
  checkStaleRetry: vi.fn(() => false),
  setWebSocketState: mockSetWebSocketState,  // Use shared mock for assertions
  setStreamingState: vi.fn(),
  setIsLoading: mockSetIsLoadingAction,
  startNewStream: mockStartNewStream,
  appendTextSegment: mockAppendTextSegment,
  addToolStartSegment: mockAddToolStartSegment,
  addToolCallSegment: mockAddToolCallSegment,
  addToolResultSegment: mockAddToolResultSegment,
  markMaxStepsReached: mockMarkMaxStepsReached,
  markUpstreamError: mockMarkUpstreamErrorAction,
  markBudgetExceeded: mockMarkBudgetExceeded,
  finalizeStream: mockFinalizeStream,
  // Phase 3 additions - machine/adapter integration
  startStream: vi.fn(),
  setError: mockSetError,  // Use shared mock for assertions
  setRecoveryState: vi.fn(),
  setRetryState: vi.fn(),
  clearActiveStream: vi.fn(),
  historyLoadingComplete: false,
  historyLoadRequested: false,
  setHistoryLoadRequested: vi.fn()
})

let streamingStoreState = createStreamingStoreState()
const mockSockets: any[] = []
const getLatestMockSocket = () => mockSockets[mockSockets.length - 1]

const createMockSocket = () => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {}

  const socket = {
    id: `mock-socket-${mockSockets.length + 1}`,
    connected: false,
    recovered: false,
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      handlers[event] = handlers[event] || []
      handlers[event]!.push(handler)
      return socket
    }),
    once: vi.fn((event, handler) => {
      const onceWrapper = (...args: any[]) => {
        socket.off(event, onceWrapper)
        handler(...args)
      }
      return socket.on(event, onceWrapper)
    }),
    off: vi.fn((event, handler) => {
      if (!handlers[event]) return socket
      if (handler) {
        handlers[event] = handlers[event]!.filter((h) => h !== handler)
      } else {
        handlers[event] = []
      }
      return socket
    }),
    removeAllListeners: vi.fn(() => {
      Object.keys(handlers).forEach((event) => {
        handlers[event] = []
      })
    }),
    disconnect: vi.fn(),
    connect: vi.fn(() => {
      socket.connected = true
      // Trigger connect event when connect() is called
      setTimeout(() => socket.trigger('connect'), 0)
      return socket
    }),
    io: {
      reconnection: vi.fn()
    },
    volatile: { emit: vi.fn() },
    trigger: (event: string, ...args: any[]) => {
      ;(handlers[event] || []).forEach((handler) => handler(...args))
    },
    getHandlers: () => handlers
  }

  mockSockets.push(socket)
  return socket
}

const setupWebSocketWithApp = async (appId = 'test-app-123') => {
  const [{ useStreamingWebSocket }, { useCurrentAppId }] = await Promise.all([
    import('./useStreamingWebSocket'),
    import('@/stores/useStreamingConversationStore')
  ])

  vi.mocked(useCurrentAppId).mockReturnValue(appId)
  streamingStoreState.currentAppId = appId

  const hook = renderHook(() => useStreamingWebSocket())

  // Run all pending timers and wait for async operations
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  })

  const socket = getLatestMockSocket()

  if (socket) {
    // Trigger connect and wait for all handlers to be set up
    await act(async () => {
      socket.trigger('connect')
      socket.connected = true
      // Wait for promises to resolve
      await Promise.resolve()
      await Promise.resolve()
      // Run timers again to complete any queued operations
      vi.runAllTimers()
      await Promise.resolve()
    })
  }

  return { hook, socket }
}

const triggerMessage = async (socket: any, payload: any) => {
  const handler = socket.getHandlers().message?.[0]
  expect(handler).toBeDefined()
  await act(async () => {
    await handler!(payload)
  })
}

// Mock all external dependencies
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => createMockSocket())
}))

vi.mock('uuid', () => ({
  validate: vi.fn(() => true)
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn()
  })),
  useQuery: vi.fn(() => ({
    data: false,
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(() => ({
    tokenAuthType: 'basic',
    isAuthenticated: true,
    isLoading: false,
  }))
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useWebSocketState: vi.fn(() => ({ connected: false, status: 'idle' })),
  useCurrentAppId: vi.fn(() => null),
  useIsActivelyStreaming: vi.fn(() => false),
  useStartNewStream: vi.fn(() => vi.fn()),
  useAppendTextSegment: vi.fn(() => vi.fn()),
  useAddToolStartSegment: vi.fn(() => vi.fn()),
  useAddToolCallSegment: vi.fn(() => vi.fn()),
  useAddToolResultSegment: vi.fn(() => vi.fn()),
  useMarkMaxStepsReached: vi.fn(() => vi.fn()),
  useMarkUpstreamError: vi.fn(() => mockMarkUpstreamErrorAction),
  useMarkBudgetExceeded: vi.fn(() => vi.fn()),
  useFinalizeStream: vi.fn(() => vi.fn()),
  useSetWebSocketState: vi.fn(() => mockSetWebSocketState),
  useSetStreamingState: vi.fn(() => vi.fn()),
  useSetIsLoading: vi.fn(() => mockSetIsLoadingAction),
  useStreamingConversationStore: {
    getState: vi.fn(() => streamingStoreState),
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
    getInstance: vi.fn(() => ({}))
  }
}));

vi.mock('@/app/[market]/develop/components/visualContextCapture', () => ({
  captureVisualContext: vi.fn(() => Promise.resolve(null))
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: vi.fn(() => (id: string) => id)
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
    cancelDeferredRegistryDestroy();
    getController()?.destroy();
    clearController();
    streamingStoreState = createStreamingStoreState()
    vi.clearAllMocks();
    mockSetIsLoadingAction.mockReset();
    mockSockets.length = 0;
    sessionStorage.clear();
    mockSetWebSocketState.mockReset();
    mockSetError.mockReset();

    // Mock fetch for JWT token
    global.fetch = vi.fn((url) => {
      const urlString = String(url)
      if (urlString.includes('/api/auth/agent-token')) {
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

      expect(result.current).toHaveProperty('actions');
      expect(result.current).toHaveProperty('connection');
      expect(result.current).toHaveProperty('stream');
      expect(typeof result.current.actions.send).toBe('function');
      expect(typeof result.current.actions.stop).toBe('function');
      expect(typeof result.current.actions.loadHistory).toBe('function');
    });

    it('should return initial connection state', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current.connection.isConnected).toBe(false);
      expect(result.current.stream.isStreaming).toBe(false);
    });
  });

  describe('stop', () => {
    it('finalizes the stream locally when activeStream is set', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');
      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');
      streamingStoreState.currentAppId = 'test-app-123';
      streamingStoreState.activeStream = {
        id: 'stream-stop',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      } as any;

      const { result } = renderHook(() => useStreamingWebSocket());

      act(() => {
        result.current.actions.stop();
      });

      expect(mockFinalizeStream).toHaveBeenCalledWith({ finishReason: 'user_stopped' });
    });

    it('does not finalize when activeStream is null', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');
      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');
      streamingStoreState.currentAppId = 'test-app-123';
      streamingStoreState.activeStream = null;

      const { result } = renderHook(() => useStreamingWebSocket());

      act(() => {
        result.current.actions.stop();
      });

      expect(mockFinalizeStream).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage functionality', () => {
    it('should not send empty or whitespace-only messages', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');
      streamingStoreState.currentAppId = 'test-app-123';

      const { result } = renderHook(() => useStreamingWebSocket());

      // Clear initial setIsLoading(false) call from idle state sync
      mockSetIsLoadingAction.mockClear();

      // Test empty string
      await result.current.actions.send({ content: '' });

      // Test whitespace only
      await result.current.actions.send({ content: '   ' });
      await result.current.actions.send({ content: '\n\t  ' });

      // Verify no state changes occurred for empty messages
      expect(result.current.connection).toBeDefined();
      expect(mockSetIsLoadingAction).not.toHaveBeenCalled();
    });

    it('should not send when content is empty even if selectedAssets are present', async () => {
      vi.useFakeTimers();
      const { hook } = await setupWebSocketWithApp('test-app-assets-only');

      mockSetIsLoadingAction.mockClear();

      await act(async () => {
        await hook.result.current.actions.send({
          content: '',
          selectedAssets: [{ imageUrl: 'https://example.com/a.jpg' } as any],
        });
      });

      expect(mockSetIsLoadingAction).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should require appId to send messages', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      // No appId
      vi.mocked(useCurrentAppId).mockReturnValue(null);

      const { result } = renderHook(() => useStreamingWebSocket());

      // Wait for initial sync microtask to complete
      await Promise.resolve();

      // Clear initial setIsLoading(false) call from idle state sync
      mockSetIsLoadingAction.mockClear();

      await result.current.actions.send({ content: 'Test message' });

      // Should not proceed without appId
      expect(result.current.connection).toBeDefined();
      expect(mockSetIsLoadingAction).not.toHaveBeenCalled();
    });

    it('should optimistically set loading state before async work', async () => {
      vi.useFakeTimers();
      const { hook } = await setupWebSocketWithApp('test-app-optimistic');

      await act(async () => {
        await hook.result.current.actions.send({ content: 'Test message' });
      });

      expect(mockSetIsLoadingAction).toHaveBeenCalledWith(true);
      vi.useRealTimers();
    });

    it('should pass full options object to controller.sendMessage', async () => {
      vi.useFakeTimers();
      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const sendMessageSpy = vi.spyOn(StreamingWebSocketController.prototype, 'sendMessage');

      const { hook } = await setupWebSocketWithApp('test-app-happy-path');

      const mockAssets = [{ id: 'asset-1', url: 'http://example.com/image.jpg' }] as any;
      const mockAiEditContext = { selector: '#test', elementInfo: { tagName: 'div' } } as any;
      const mockTodoContext = { todos: [] } as any;
      const mockCustomContext = { referencedFiles: [] } as any;

      await act(async () => {
        await hook.result.current.actions.send({
          content: 'Build a login page',
          selectedAssets: mockAssets,
          aiEditContext: mockAiEditContext,
          todoListContext: mockTodoContext,
          isActionRequest: true,
          customContext: mockCustomContext,
        });
      });

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Build a login page',
          selectedAssets: mockAssets,
          aiEditContext: mockAiEditContext,
          todoListContext: mockTodoContext,
          isActionRequest: true,
          customContext: mockCustomContext,
        })
      );

      sendMessageSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should reset loading state when controller.sendMessage throws synchronously', async () => {
      vi.useFakeTimers();
      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const controllerSpy = vi.spyOn(StreamingWebSocketController.prototype, 'sendMessage').mockImplementationOnce(() => {
        throw new Error('sync failure');
      });

      const { hook } = await setupWebSocketWithApp('test-app-sync-error');

      await act(async () => {
        await hook.result.current.actions.send({ content: 'Trigger failure' });
      });

      expect(mockSetIsLoadingAction).toHaveBeenCalledWith(true);
      expect(mockSetIsLoadingAction).toHaveBeenCalledWith(false);

      controllerSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('WebSocket state management', () => {
    it('should expose webSocketState from store', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useWebSocketState } = await import('@/stores/useStreamingConversationStore');

      const mockState = { connected: true, status: 'streaming' as const };
      vi.mocked(useWebSocketState).mockReturnValue(mockState);

      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current.connection.isConnected).toBe(true);
      expect(result.current.connection.status).toBe('streaming');
      expect(result.current.stream.isStreaming).toBe(true);
    });

    it('should correctly determine isStreaming from status', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useWebSocketState } = await import('@/stores/useStreamingConversationStore');

      // Test streaming status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: true, status: 'streaming' });
      const { result: result1 } = renderHook(() => useStreamingWebSocket());
      expect(result1.current.stream.isStreaming).toBe(true);

      // Test idle status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: true, status: 'idle' });
      const { result: result2 } = renderHook(() => useStreamingWebSocket());
      expect(result2.current.stream.isStreaming).toBe(false);

      // Test error status
      vi.mocked(useWebSocketState).mockReturnValue({ connected: false, status: 'error', error: { message: 'Test error' } });
      const { result: result3 } = renderHook(() => useStreamingWebSocket());
      expect(result3.current.stream.isStreaming).toBe(false);
    });
  });

  describe('Store integration', () => {
    it('should use required store selector hooks and getState for actions', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const {
        useWebSocketState,
        useCurrentAppId,
        useStreamingConversationStore,
      } = await import('@/stores/useStreamingConversationStore');

      renderHook(() => useStreamingWebSocket());

      // Verify selector hooks are still called for rendering
      expect(useWebSocketState).toHaveBeenCalled();
      expect(useCurrentAppId).toHaveBeenCalled();

      // Actions are now accessed via store.getState() (getActions pattern)
      // rather than individual hook selectors
      expect(useStreamingConversationStore.getState).toHaveBeenCalled();
    });

    it('should read store state at flush time via getState', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useStreamingConversationStore } = await import('@/stores/useStreamingConversationStore');

      renderHook(() => useStreamingWebSocket());

      // The module-level tool delta buffer reads updateToolDelta via getState()
      // at flush time rather than subscribing to the store.
      expect(useStreamingConversationStore.getState).toHaveBeenCalled();
    });
  });

  describe('Session origin from auth type', () => {
    it('should set session origin to support for e2s auth type', async () => {
      vi.useFakeTimers();
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const setSessionOriginSpy = vi.spyOn(StreamingWebSocketController.prototype, 'setSessionOrigin');

      // Mock e2s auth type (employee-to-shopper)
      vi.mocked(useAuthContext).mockReturnValue({
        tokenAuthType: 'e2s',
        isAuthenticated: true,
        isLoading: false,
      } as any);

      await setupWebSocketWithApp('app-e2s-origin');

      expect(setSessionOriginSpy).toHaveBeenCalledWith('support');

      setSessionOriginSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should set session origin to support for e2s2s auth type', async () => {
      vi.useFakeTimers();
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const setSessionOriginSpy = vi.spyOn(StreamingWebSocketController.prototype, 'setSessionOrigin');

      // Mock e2s2s auth type (employee-to-shopper-to-shopper)
      vi.mocked(useAuthContext).mockReturnValue({
        tokenAuthType: 'e2s2s',
        isAuthenticated: true,
        isLoading: false,
      } as any);

      await setupWebSocketWithApp('app-e2s2s-origin');

      expect(setSessionOriginSpy).toHaveBeenCalledWith('support');

      setSessionOriginSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should set session origin to customer for basic auth type', async () => {
      vi.useFakeTimers();
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const setSessionOriginSpy = vi.spyOn(StreamingWebSocketController.prototype, 'setSessionOrigin');

      // Mock basic auth type (regular customer)
      vi.mocked(useAuthContext).mockReturnValue({
        tokenAuthType: 'basic',
        isAuthenticated: true,
        isLoading: false,
      } as any);

      await setupWebSocketWithApp('app-basic-origin');

      expect(setSessionOriginSpy).toHaveBeenCalledWith('customer');

      setSessionOriginSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('Error handling', () => {
    it('should handle fetch errors for JWT token gracefully', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      // Make fetch fail
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error'))) as any;
      vi.mocked(useCurrentAppId).mockReturnValue('test-app-123');

      // Should not throw
      const { result } = renderHook(() => useStreamingWebSocket());

      expect(result.current).toBeDefined();
      expect(result.current.actions.send).toBeInstanceOf(Function);
    });

    it('should handle visual context capture errors gracefully', async () => {
      // Regression test for Bug 3: Visual context errors escaping error handling
      vi.useFakeTimers()
      const { captureVisualContext } = await import('@/app/[market]/develop/components/visualContextCapture');

      // Make captureVisualContext throw an error
      vi.mocked(captureVisualContext).mockRejectedValue(new Error('Iframe not ready'));

      const { socket } = await setupWebSocketWithApp('app-visual-error')

      // sendMessage should not throw even if visual context capture fails
      await expect(async () => {
        const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
        const { result } = renderHook(() => useStreamingWebSocket());
        await result.current.actions.send({ content: 'Test message' });
      }).not.toThrow();

      vi.useRealTimers()
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on unmount', async () => {
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');

      const { unmount } = renderHook(() => useStreamingWebSocket());

      // Should unmount without errors
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('StrictMode lifecycle', () => {
    it('completes hook setup when mount effect runs twice', async () => {
      vi.useFakeTimers();
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');
      const registry = await import('@/services/websocket/controllerRegistry');
      const setControllerSpy = vi.spyOn(registry, 'setController');

      vi.mocked(useCurrentAppId).mockReturnValue('app-strict-lifecycle');
      streamingStoreState.currentAppId = 'app-strict-lifecycle';

      const { StreamingWebSocketController } = await import('@/services/websocket/StreamingWebSocketController');
      const connectSpy = vi.spyOn(StreamingWebSocketController.prototype, 'connect');

      const wrapper = function strictWrapper({ children }: { children: ReactNode }) {
        return createElement(StrictMode, null, children);
      };

      const { result, unmount } = renderHook(() => useStreamingWebSocket(), { wrapper });

      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.actions.send).toBeInstanceOf(Function);
      expect(connectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(setControllerSpy).toHaveBeenCalledTimes(1);

      connectSpy.mockRestore();
      setControllerSpy.mockRestore();
      unmount();
      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
      });
      vi.useRealTimers();
    });
  });

  describe('rapid app id switching', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('establishes transport for final app after three back-to-back id changes', async function threeBackToBack() {
      vi.useFakeTimers();
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');
      const { ConnectionManager } = await import('@/services/websocket/ConnectionManager');

      vi.mocked(useCurrentAppId).mockImplementation(() => streamingStoreState.currentAppId);

      const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');

      streamingStoreState.currentAppId = 'rapid-chain-a';
      const { rerender } = renderHook(() => useStreamingWebSocket());

      streamingStoreState.currentAppId = 'rapid-chain-b';
      rerender();

      streamingStoreState.currentAppId = 'rapid-chain-c';
      rerender();

      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
        await Promise.resolve();
      });

      const connectCallsForFinal = connectSpy.mock.calls.filter((c) => c[0] === 'rapid-chain-c');
      expect(connectCallsForFinal.length).toBeGreaterThanOrEqual(1);

      const socket = getLatestMockSocket();
      expect(socket).toBeDefined();

      await act(async () => {
        socket.trigger('connect');
        socket.connected = true;
        await Promise.resolve();
        socket.trigger('authenticateSuccess', { socketId: socket.id });
        await Promise.resolve();
        vi.runAllTimers();
        await Promise.resolve();
      });

      const reachedConnected = mockSetWebSocketState.mock.calls.some(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as { connected?: boolean }).connected === true
      );
      expect(reachedConnected).toBe(true);

      connectSpy.mockRestore();
    });

    it('establishes final app when ids change during ConnectionManager connect delay', async function duringDelay() {
      vi.useFakeTimers();
      const { useStreamingWebSocket } = await import('./useStreamingWebSocket');
      const { useCurrentAppId } = await import('@/stores/useStreamingConversationStore');

      vi.mocked(useCurrentAppId).mockImplementation(() => streamingStoreState.currentAppId);

      streamingStoreState.currentAppId = 'midload-a';
      const { rerender } = renderHook(() => useStreamingWebSocket());

      await act(() => {
        vi.advanceTimersByTime(100);
      });

      streamingStoreState.currentAppId = 'midload-b';
      rerender();

      await act(() => {
        vi.advanceTimersByTime(100);
      });

      streamingStoreState.currentAppId = 'midload-c';
      rerender();

      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
        await Promise.resolve();
      });

      const socket = getLatestMockSocket();
      expect(socket).toBeDefined();

      await act(async () => {
        socket.trigger('connect');
        socket.connected = true;
        await Promise.resolve();
        socket.trigger('authenticateSuccess', { socketId: socket.id });
        await Promise.resolve();
        vi.runAllTimers();
        await Promise.resolve();
      });

      const reachedConnected = mockSetWebSocketState.mock.calls.some(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as { connected?: boolean }).connected === true
      );
      expect(reachedConnected).toBe(true);
    });
  });

  describe('manual recovery housekeeping', () => {
    it('preserves stored socket id after stream completion for recovery', async () => {
      vi.useFakeTimers()
      const { socket } = await setupWebSocketWithApp('app-123')

      expect(sessionStorage.getItem('socket_id_app-123')).toBe(socket.id)

      await triggerMessage(socket, {
        type: 'complete',
        content: '',
        data: { step: 1 }
      })

      // Socket ID should be preserved to enable recovery on page reload
      expect(sessionStorage.getItem('socket_id_app-123')).toBe(socket.id)
      vi.useRealTimers()
    })

    it('preserves stored socket id after fatal error for recovery', async () => {
      vi.useFakeTimers()
      const { socket } = await setupWebSocketWithApp('app-456')

      expect(sessionStorage.getItem('socket_id_app-456')).toBe(socket.id)

      await triggerMessage(socket, {
        type: 'error',
        content: 'Budget exceeded',
        data: { errorType: 'BUDGET_EXCEEDED' }
      })

      // Socket ID should be preserved to enable recovery attempts
      expect(sessionStorage.getItem('socket_id_app-456')).toBe(socket.id)
      vi.useRealTimers()
    })

    it('sends recovery_ack when replay_complete arrives even if count mismatch', async () => {
      vi.useFakeTimers()
      const { socket } = await setupWebSocketWithApp('app-789')

      await triggerMessage(socket, {
        type: 'recovery_status',
        data: {
          requiresAck: true,
          bufferedEventCount: 2,
          conversationId: 'conv-1',
          lastSequence: 18
        }
      })

      await triggerMessage(socket, { type: 'chunk', content: 'partial' })

      await triggerMessage(socket, {
        type: 'replay_complete',
        data: {
          conversationId: 'conv-1',
          lastSequence: 18,
          eventsReplayed: 2
        }
      })

      // Server said replay is complete - ack should be sent even though only 1 event tracked
      expect(socket.emit).toHaveBeenCalledWith('recovery_ack', {
        conversationId: 'conv-1',
        lastSequence: 18
      })

      act(() => {
        socket.trigger('disconnect')
      })

      await triggerMessage(socket, { type: 'chunk', content: 'new data' })

      // After disconnect, pending ack state should be cleared, no duplicate acks
      const ackCalls = socket.emit.mock.calls.filter(([event]) => event === 'recovery_ack')
      expect(ackCalls).toHaveLength(1) // Only the one from replay_complete
      vi.useRealTimers()
    })

    it('emits catchup_ack after receiving catch-up replay', async () => {
      vi.useFakeTimers()
      const { socket } = await setupWebSocketWithApp('app-catchup')

      await triggerMessage(socket, {
        type: 'catchup_status',
        data: {
          requiresAck: true,
          conversationId: 'conv-catch',
          lastSequence: 50,
          pendingCount: 2
        }
      })

      await triggerMessage(socket, { type: 'chunk', content: 'delta 1' })
      await triggerMessage(socket, { type: 'chunk', content: 'delta 2' })

      await triggerMessage(socket, {
        type: 'catchup_complete',
        data: {
          conversationId: 'conv-catch',
          lastSequence: 52,
          eventsReplayed: 2
        }
      })

      const catchupAck = socket.emit.mock.calls.find(([event]) => event === 'catchup_ack')
      expect(catchupAck).toEqual([
        'catchup_ack',
        {
          conversationId: 'conv-catch',
          lastSequence: 52
        }
      ])
      vi.useRealTimers()
    })

    it('surface warning when lossDetected flag is set', async () => {
      vi.useFakeTimers()
      const { socket } = await setupWebSocketWithApp('app-loss')

      await triggerMessage(socket, {
        type: 'recovery_status',
        data: {
          streamCompleted: true,
          lossDetected: true,
          conversationId: 'conv-loss'
        }
      })

      // Wait for machine and adapter to process
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockMarkUpstreamErrorAction).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('could not be recovered')
      }))
      vi.useRealTimers()
    })
  })
});
