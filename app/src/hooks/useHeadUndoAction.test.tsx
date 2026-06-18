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
import type { ChatMessage } from '@/stores/useStreamingConversationStore';
import { extractChatTurnCommits, useHeadUndoAction } from './useHeadUndoAction';

const {
  mockAppId,
  mockIsStreaming,
  mockMessages,
  mockRestoreMutate,
  mockRestoreIsPending,
  mockAddCompletedMessage,
  mockGitHistoryFetching,
  mockLogClickEvent,
} = vi.hoisted(() => ({
  mockLogClickEvent: vi.fn(() => vi.fn()),
  mockAppId: { value: 'test-app-123' as string | null },
  mockIsStreaming: { value: false },
  mockMessages: { value: [] as ChatMessage[] },
  mockRestoreMutate: vi.fn(),
  mockRestoreIsPending: { value: false },
  mockAddCompletedMessage: vi.fn(),
  mockGitHistoryFetching: { value: false },
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

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    data: { commits: [], currentCommit: null, hasMore: false },
    isLoading: false,
    isFetching: mockGitHistoryFetching.value,
    error: null,
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
  useMessages: () => mockMessages.value,
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

function userMsg(id: string): ChatMessage {
  return { id, role: 'user', content: 'hi', timestamp: new Date() } as ChatMessage;
}

function agentMsg(id: string, commitHash?: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'response',
    timestamp: new Date(),
    ...(commitHash ? { commitHash } : {}),
  } as ChatMessage;
}

function restoreNotice(id: string): ChatMessage {
  return {
    id,
    role: 'user',
    content: '[system] restored',
    timestamp: new Date(),
    metadata: { kind: 'restore', commitHash: 'whatever' },
  } as ChatMessage;
}

function makeNotice(overrides: Partial<RestoreNotice> = {}): RestoreNotice {
  return {
    id: 'notice-undo',
    role: 'user',
    content: '[system] undid',
    createdAt: new Date('2026-05-18T12:00:00Z').toISOString(),
    metadata: { kind: 'restore', commitHash: 'parent', stashHash: null, restoredCommitHash: 'parent' },
    ...overrides,
  };
}

function makeResult(overrides: Partial<RestoreCommitResult> = {}): RestoreCommitResult {
  return { hasChanges: false, stashHash: null, notice: makeNotice(), ...overrides };
}

describe('useHeadUndoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppId.value = 'test-app-123';
    mockIsStreaming.value = false;
    mockRestoreIsPending.value = false;
    mockMessages.value = [];
    mockGitHistoryFetching.value = false;
    useGitStore.getState().clearAppState('test-app-123');
  });

  describe('lock state', () => {
    it('locks when there is no app id', () => {
      mockAppId.value = null;
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when there are zero chat-turn commits', () => {
      mockMessages.value = [userMsg('u1'), agentMsg('a1')]; // no commitHash
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when only one chat-turn commit exists (no parent to step back to)', () => {
      mockMessages.value = [userMsg('u1'), agentMsg('a1', 'A')];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when the agent is streaming', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      mockIsStreaming.value = true;
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks while git-history is mid-fetch', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      mockGitHistoryFetching.value = true;
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('unlocks when there are 2+ chat-turn commits and the agent is idle', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);
    });
  });

  describe('triggerUndo', () => {
    it('targets the previous chat turn (cursor\'s next-older entry in the timeline)', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      expect(mockRestoreMutate).toHaveBeenCalledTimes(1);
      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({
        appId: 'test-app-123',
        commitHash: 'A',
      });
    });

    it('fires the develop.header.undo click EID exactly once with cursor/target payload', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const undoCalls = (mockLogClickEvent.mock.calls as unknown[][]).filter(
        (c) => c[0] === 'develop.header.undo',
      );
      expect(undoCalls).toHaveLength(1);
      expect(undoCalls[0][1]).toEqual({ cursor: 'B', target: 'A' });
    });

    it('on success, pushes the cursor onto redo stack and advances cursor to target', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });
      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onSuccess(makeResult({ notice: makeNotice({ id: 'n1' }) }));
      });

      expect(useGitStore.getState().getUndoCursor('test-app-123')).toBe('A');
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['B']);
    });

    it('skips assistant messages without commitHash and restore notices in the timeline', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2-no-commit'),  // no commitHash
        userMsg('u3'), agentMsg('a3', 'B'),
        restoreNotice('r1'),  // restore notices skipped
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      // Timeline: [B, A]. Cursor=B, target=A.
      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({
        appId: 'test-app-123',
        commitHash: 'A',
      });
    });

    it('chained undo: walks back through multiple chat turns', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
        userMsg('u3'), agentMsg('a3', 'C'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });

      // First undo: cursor=C → target=B
      act(() => {
        result.current.triggerUndo();
      });
      act(() => {
        mockRestoreMutate.mock.calls[0][1].onSuccess(makeResult({
          notice: makeNotice({ id: 'n1', metadata: { kind: 'restore', commitHash: 'B', stashHash: null, restoredCommitHash: 'B' } }),
        }));
      });
      expect(useGitStore.getState().getUndoCursor('test-app-123')).toBe('B');
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['C']);

      // Second undo: cursor=B → target=A
      act(() => {
        result.current.triggerUndo();
      });
      expect(mockRestoreMutate.mock.calls[1][0]).toEqual({
        appId: 'test-app-123',
        commitHash: 'A',
      });
    });

    it('is a no-op when locked', () => {
      mockMessages.value = [userMsg('u1'), agentMsg('a1', 'A')];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerUndo();
      });
      expect(mockRestoreMutate).not.toHaveBeenCalled();
    });

    it('surfaces an error and does not seed the redo stack on failure', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerUndo();
      });
      act(() => {
        mockRestoreMutate.mock.calls[0][1].onError(new Error('boom'));
      });
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual([]);
      expect(result.current.error).not.toBeNull();
    });
  });

  describe('extractChatTurnCommits', () => {
    it('dedupes consecutive assistant messages sharing the same commitHash', () => {
      const result = extractChatTurnCommits([
        userMsg('u1'), agentMsg('a1a', 'A'), agentMsg('a1b', 'A'),
        userMsg('u2'), agentMsg('a2a', 'B'), agentMsg('a2b', 'B'),
        userMsg('u3'), agentMsg('a3', 'C'),
      ]);
      expect(result).toEqual(['C', 'B', 'A']);
    });

    it('skips assistant messages whose commitHash is a known Restore SHA', () => {
      const result = extractChatTurnCommits(
        [
          userMsg('u1'), agentMsg('a1', 'A'),
          userMsg('u2'), agentMsg('a2-intermediate', 'RESTORE_SHA'),
          userMsg('u3'), agentMsg('a3', 'C'),
        ],
        new Set(['RESTORE_SHA']),
      );
      expect(result).toEqual(['C', 'A']);
    });
  });

  describe('clearError', () => {
    it('resets the error state', () => {
      mockMessages.value = [
        userMsg('u1'), agentMsg('a1', 'A'),
        userMsg('u2'), agentMsg('a2', 'B'),
      ];
      const { result } = renderHook(() => useHeadUndoAction(), { wrapper: createWrapper() });
      act(() => {
        result.current.triggerUndo();
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
