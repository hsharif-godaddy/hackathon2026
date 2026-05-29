/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatReadyState } from '@gdcorp-digitalcare/ux/ux-client';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useSupportChat } from './useSupportChat';

// Mock the DigitalCareUXClient
const mockChatInit = vi.fn();
const mockChatLaunch = vi.fn();
const mockChatDispose = vi.fn();

vi.mock('@gdcorp-digitalcare/ux', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        init: mockChatInit,
        launch: mockChatLaunch,
        dispose: mockChatDispose,
      },
    })),
  };
});

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useSupportChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatInit.mockResolvedValue(undefined);
  });

  describe('lazy initialization', () => {
    it('should not initialize chat client on mount', () => {
      renderHook(() => useSupportChat());

      expect(mockChatInit).not.toHaveBeenCalled();
    });

    it('should return isLoading as false initially', () => {
      const { result } = renderHook(() => useSupportChat());

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('launchSupportChat', () => {
    it('should initialize chat client on first launch call', async () => {
      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      expect(mockChatInit).toHaveBeenCalledOnce();
      expect(mockChatInit).toHaveBeenCalledWith({
        launchAiroCare: true,
        readyStateHandler: expect.any(Function),
      });
    });

    it('should set isLoading to true when initialization starts', async () => {
      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should call launch after successful initialization', async () => {
      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(mockChatInit).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockChatLaunch).toHaveBeenCalledOnce();
      });
    });

    it('should not initialize multiple times if called while initializing', async () => {
      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
        result.current.launchSupportChat();
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(mockChatInit).toHaveBeenCalledOnce();
      });
    });

    it('should launch immediately if already initialized', async () => {
      const { result } = renderHook(() => useSupportChat());

      // First call to initialize
      act(() => {
        result.current.launchSupportChat();
      });

      // Wait for initialization to complete and launch to be called
      await waitFor(() => {
        expect(mockChatLaunch).toHaveBeenCalled();
      });

      // Reset mock to track second launch
      mockChatLaunch.mockClear();

      // Second call should launch immediately
      act(() => {
        result.current.launchSupportChat();
      });

      expect(mockChatLaunch).toHaveBeenCalledOnce();
      expect(mockChatInit).toHaveBeenCalledOnce(); // Still only called once
    });
  });

  describe('ready state handling', () => {
    it('should update isLoading based on ready state', async () => {
      let capturedReadyStateHandler: ((state: ChatReadyState) => void) | null = null;

      mockChatInit.mockImplementation((options) => {
        capturedReadyStateHandler = options.readyStateHandler;
        return Promise.resolve();
      });

      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(capturedReadyStateHandler).not.toBeNull();
      });

      // Simulate Loading state
      act(() => {
        capturedReadyStateHandler!(ChatReadyState.Loading);
      });

      expect(result.current.isLoading).toBe(true);

      // Simulate Initializing state
      act(() => {
        capturedReadyStateHandler!(ChatReadyState.Initializing);
      });

      expect(result.current.isLoading).toBe(true);

      // Simulate Ready state
      act(() => {
        capturedReadyStateHandler!(ChatReadyState.Ready);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should set isLoading to false on TimedOut state', async () => {
      let capturedReadyStateHandler: ((state: ChatReadyState) => void) | null = null;

      mockChatInit.mockImplementation((options) => {
        capturedReadyStateHandler = options.readyStateHandler;
        return Promise.resolve();
      });

      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(capturedReadyStateHandler).not.toBeNull();
      });

      act(() => {
        capturedReadyStateHandler!(ChatReadyState.TimedOut);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should set isLoading to false on Disabled state', async () => {
      let capturedReadyStateHandler: ((state: ChatReadyState) => void) | null = null;

      mockChatInit.mockImplementation((options) => {
        capturedReadyStateHandler = options.readyStateHandler;
        return Promise.resolve();
      });

      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(capturedReadyStateHandler).not.toBeNull();
      });

      act(() => {
        capturedReadyStateHandler!(ChatReadyState.Disabled);
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should set isLoading to false on initialization error', async () => {
      mockChatInit.mockRejectedValue(new Error('Init failed'));

      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should not call launch if initialization fails', async () => {
      mockChatInit.mockRejectedValue(new Error('Init failed'));

      const { result } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(mockChatInit).toHaveBeenCalled();
      });

      expect(mockChatLaunch).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should call dispose on unmount if chat client was initialized', async () => {
      const { result, unmount } = renderHook(() => useSupportChat());

      act(() => {
        result.current.launchSupportChat();
      });

      await waitFor(() => {
        expect(mockChatInit).toHaveBeenCalled();
      });

      unmount();

      expect(mockChatDispose).toHaveBeenCalledOnce();
    });

    it('should not call dispose on unmount if chat client was not initialized', () => {
      const { unmount } = renderHook(() => useSupportChat());

      unmount();

      expect(mockChatDispose).not.toHaveBeenCalled();
    });
  });

  describe('pending launch behavior', () => {
    it('should queue launch if called during initialization', async () => {
      let resolveInit: () => void;
      const initPromise = new Promise<void>((resolve) => {
        resolveInit = resolve;
      });

      mockChatInit.mockReturnValue(initPromise);

      const { result } = renderHook(() => useSupportChat());

      // Start initialization
      act(() => {
        result.current.launchSupportChat();
      });

      // Call launch again while still initializing
      act(() => {
        result.current.launchSupportChat();
      });

      // Init should only be called once
      expect(mockChatInit).toHaveBeenCalledOnce();

      // Resolve initialization
      await act(async () => {
        resolveInit!();
        await initPromise;
      });

      // Launch should have been called after init completed
      await waitFor(() => {
        expect(mockChatLaunch).toHaveBeenCalledOnce();
      });
    });
  });
});
