/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import type { RestoreCommitResult } from '@/hooks/useRestoreCommitMutation';
import type { RestoreNotice } from '@/services/AppService';
import { useGitStore } from '@/stores/useGitStore';
import { useRedoAction } from './useRedoAction';

const {
  mockAppId,
  mockIsStreaming,
  mockRestoreMutate,
  mockRestoreIsPending,
  mockAddCompletedMessage,
  mockLogClickEvent,
} = vi.hoisted(() => ({
  mockLogClickEvent: vi.fn(() => vi.fn()),
  mockAppId: { value: 'test-app-123' as string | null },
  mockIsStreaming: { value: false },
  mockRestoreMutate: vi.fn(),
  mockRestoreIsPending: { value: false },
  mockAddCompletedMessage: vi.fn(),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId.value,
}));

vi.mock('@/hooks/useRestoreCommitMutation', () => ({
  useRestoreCommitMutation: () => ({
    mutate: mockRestoreMutate,
    isPending: mockRestoreIsPending.value,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, _values?: unknown, fallback?: string) => fallback || _key,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mockIsStreaming.value,
  useStreamingConversationStore: (
    selector: (state: { addCompletedMessage: typeof mockAddCompletedMessage }) => unknown,
  ) => selector({ addCompletedMessage: mockAddCompletedMessage }),
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: mockLogClickEvent,
  generateClickEID: () => '',
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeNotice(overrides: Partial<RestoreNotice> = {}): RestoreNotice {
  return {
    id: 'notice-redo',
    role: 'user',
    content: '[system] redid',
    createdAt: new Date('2026-05-18T12:00:00Z').toISOString(),
    metadata: { kind: 'restore', commitHash: 'A', stashHash: null, restoredCommitHash: 'A' },
    ...overrides,
  };
}

function makeResult(overrides: Partial<RestoreCommitResult> = {}): RestoreCommitResult {
  return { hasChanges: false, stashHash: null, notice: makeNotice(), ...overrides };
}

describe('useRedoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppId.value = 'test-app-123';
    mockIsStreaming.value = false;
    mockRestoreIsPending.value = false;
    useGitStore.getState().clearAppState('test-app-123');
  });

  describe('lock state', () => {
    it('locks when no app id is available', () => {
      mockAppId.value = null;
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when the redo stack is empty', () => {
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('unlocks when stack has an entry and the agent is idle', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);
    });

    it('locks while the agent is streaming', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      mockIsStreaming.value = true;
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks while the restore mutation is in flight', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      mockRestoreIsPending.value = true;
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });
  });

  describe('triggerRedo', () => {
    it('pops the stack, restores to the popped SHA, and advances cursor to it', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerRedo();
      });

      expect(mockRestoreMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'B' });
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual([]);

      act(() => {
        options.onSuccess(makeResult({ notice: makeNotice({ id: 'n1' }) }));
      });
      expect(useGitStore.getState().getUndoCursor('test-app-123')).toBe('B');
      expect(mockAddCompletedMessage).toHaveBeenCalledTimes(1);
    });

    it('fires the develop.header.redo click EID exactly once with the popped target', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerRedo();
      });

      const redoCalls = (mockLogClickEvent.mock.calls as unknown[][]).filter(
        (c) => c[0] === 'develop.header.redo',
      );
      expect(redoCalls).toHaveLength(1);
      expect(redoCalls[0][1]).toEqual({ target: 'B' });
    });

    it('restores the popped entry on failure so the user can retry', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerRedo();
      });
      act(() => {
        mockRestoreMutate.mock.calls[0][1].onError(new Error('network down'));
      });
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['B']);
      expect(result.current.error).not.toBeNull();
    });

    it('is a no-op when the stack is empty', () => {
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerRedo();
      });
      expect(mockRestoreMutate).not.toHaveBeenCalled();
    });
  });

  describe('clearError', () => {
    it('resets the error state', () => {
      useGitStore.getState().pushRedo('test-app-123', 'B');
      const { result } = renderHook(() => useRedoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerRedo();
      });
      act(() => {
        mockRestoreMutate.mock.calls[0][1].onError(new Error('boom'));
      });
      expect(result.current.error).not.toBeNull();
      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });
  });
});
