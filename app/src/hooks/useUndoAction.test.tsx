/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { RestoreCommitResult } from '@/hooks/useRestoreCommitMutation';
import type { RestoreNotice } from '@/services/AppService';
import { useGitStore } from '@/stores/useGitStore';
import type { ChatMessage } from '@/stores/useStreamingConversationStore';
import { useUndoAction } from './useUndoAction';

type GitCommitMock = { hash: string; message: string; author: string; date: string }

const {
  mockAppId,
  mockIsStreaming,
  mockMessages,
  mockStopGeneration,
  mockRestoreMutate,
  mockRestoreIsPending,
  mockAddCompletedMessage,
  mockClearActiveStream,
  mockGitCommits,
} = vi.hoisted(() => ({
  mockAppId: { value: 'test-app-123' as string | null },
  mockIsStreaming: { value: false },
  mockMessages: { value: [] as ChatMessage[] },
  mockStopGeneration: vi.fn().mockResolvedValue(undefined),
  mockRestoreMutate: vi.fn(),
  mockRestoreIsPending: { value: false },
  mockAddCompletedMessage: vi.fn(),
  mockClearActiveStream: vi.fn(),
  mockGitCommits: { value: [] as { hash: string; message: string; author: string; date: string }[] },
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId.value,
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: vi.fn(),
    loadHistory: vi.fn(function () { return true; }),
    stopGeneration: mockStopGeneration,
  }),
}));

vi.mock('@/hooks/useRestoreCommitMutation', () => ({
  useRestoreCommitMutation: () => ({
    mutate: mockRestoreMutate,
    isPending: mockRestoreIsPending.value,
  }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    data: { commits: mockGitCommits.value, currentCommit: mockGitCommits.value[0]?.hash ?? null, hasMore: false },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, _values?: unknown, fallback?: string) => fallback || _key,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mockIsStreaming.value,
  useMessages: () => mockMessages.value,
  // The hook calls `useStreamingConversationStore(selector)` — emulate the
  // selector contract by feeding it the slice shape it expects.
  useStreamingConversationStore: (
    selector: (state: {
      addCompletedMessage: typeof mockAddCompletedMessage
      clearActiveStream: typeof mockClearActiveStream
    }) => unknown,
  ) =>
    selector({
      addCompletedMessage: mockAddCompletedMessage,
      clearActiveStream: mockClearActiveStream,
    }),
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
    id: 'notice-1',
    role: 'user',
    content: '[system] The user performed a rollback.',
    createdAt: new Date('2026-05-18T12:00:00Z').toISOString(),
    // Matches the persisted `RestoreActionMetadata` shape from
    // `@airo/shared/chat` — `isRestoreMetadata` checks `kind === 'restore'`.
    metadata: {
      kind: 'restore',
      commitHash: null,
      stashHash: null,
    },
    ...overrides,
  };
}

function makeResult(overrides: Partial<RestoreCommitResult> = {}): RestoreCommitResult {
  return {
    hasChanges: false,
    stashHash: null,
    notice: makeNotice(),
    ...overrides,
  };
}

function userPromptMessage(id: string, commitHash?: string): ChatMessage {
  return {
    id,
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
    ...(commitHash ? { metadata: { commitHash } } : {}),
  } as ChatMessage;
}

// Stash-only undo: no `restoredCommitHash`. Hashes use the persisted-shape
// discriminant (`kind: 'restore'`) so `isRestoreMetadata` recognises them.
const undoNoticeMessage = (id: string, commitHash: string | null = null): ChatMessage => ({
  id,
  role: 'user',
  content: '[system] undid',
  timestamp: new Date(),
  metadata: {
    kind: 'restore',
    commitHash,
  },
} as ChatMessage);

// Per-prompt restore notice: carries a `restoredCommitHash` to distinguish
// it from a stash-only undo at render time.
const restoreNoticeMessage = (id: string, commitHash: string | null = 'restored-target'): ChatMessage => ({
  id,
  role: 'user',
  content: '[system] restored',
  timestamp: new Date(),
  metadata: {
    kind: 'restore',
    commitHash,
    restoredCommitHash: commitHash,
  },
} as ChatMessage);

describe('useUndoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppId.value = 'test-app-123';
    mockIsStreaming.value = false;
    mockMessages.value = [];
    mockGitCommits.value = [];
    mockRestoreIsPending.value = false;
    mockStopGeneration.mockResolvedValue(undefined);
    useGitStore.getState().clearAppState('test-app-123');
  });

  function makeCommit(hash: string): GitCommitMock {
    return { hash, message: hash, author: 'agent', date: '2026-05-18T12:00:00Z' };
  }

  function assistantMessage(id: string, commitHash?: string): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: 'response',
      timestamp: new Date(),
      ...(commitHash ? { commitHash, metadata: { commitHash } } : {}),
    } as ChatMessage;
  }

  function userStoppedAssistantMessage(id: string): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: 'partial response',
      timestamp: new Date(),
      userStopped: true,
    } as ChatMessage;
  }

  describe('lock state', () => {
    it('locks when the transcript is empty (nothing to undo)', () => {
      // The hook treats an empty transcript as an implicit lock: there's
      // nothing for the button to roll back to, so we don't surface it.
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('unlocks when the responding assistant has committed and HEAD is at that commit', () => {
      // The unlock condition: a regular user prompt has a responding
      // assistant turn whose commit is the current HEAD, and the parent of
      // that commit is loaded in the history page.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);
    });

    it('locks when the responding assistant has not committed yet (in-flight or errored)', () => {
      // Without a responding assistant commit there's no rollback target —
      // clicking would only fire a stash-only no-op when the tree is clean,
      // which the user perceives as the button doing nothing.
      mockMessages.value = [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() } as ChatMessage];
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it("locks when the responding assistant's commit isn't loaded in the current history page", () => {
      // Parent lookup fails — we don't know what the pre-prompt state was,
      // so Undo can't safely rewind. Restore icon should show instead.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('unrelated-commit')];
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it("locks when HEAD has drifted off the responding assistant's commit", () => {
      // An editor commit, asset upload, or external commit landed on top of
      // the agent's last commit. Rewinding to pre-prompt would silently
      // discard that intervening work, so Undo isn't safe — the caller
      // falls back to Restore (preview-only).
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [
        makeCommit('editor-commit'),
        makeCommit('agent-commit'),
        makeCommit('pre-prompt'),
      ];
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when no app id is available', () => {
      mockAppId.value = null;
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('reflects restoreMutation pending state in isPending and isLocked', () => {
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];
      mockRestoreIsPending.value = true;
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isPending).toBe(true);
      expect(result.current.isLocked).toBe(true);
    });
  });

  describe('streaming branch — stop, then rewind', () => {
    it('awaits stopGeneration before firing the rewind', async () => {
      mockIsStreaming.value = true;

      // Make stopGeneration resolve only after we manually unblock it, so we
      // can assert that the mutation hasn't fired before the ack lands.
      let resolveStop: () => void = () => {};
      mockStopGeneration.mockImplementationOnce(
        function () { return new Promise<void>((resolve) => {
          resolveStop = resolve;
        }); },
      );

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      expect(mockStopGeneration).toHaveBeenCalledTimes(1);
      expect(mockRestoreMutate).not.toHaveBeenCalled();

      await act(async () => {
        resolveStop();
      });

      await waitFor(() => expect(mockRestoreMutate).toHaveBeenCalledTimes(1));
      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({ appId: 'test-app-123' });
    });

    it('mirrors the persisted notice into the local transcript on success', async () => {
      mockIsStreaming.value = true;

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      await waitFor(() => expect(mockRestoreMutate).toHaveBeenCalledTimes(1));
      const [, options] = mockRestoreMutate.mock.calls[0];
      const notice = makeNotice({ id: 'notice-stream', metadata: { kind: 'restore', commitHash: null, stashHash: 'stash-hash' } });
      act(() => {
        options.onSuccess(makeResult({ hasChanges: true, stashHash: 'stash-hash', notice }));
      });

      expect(mockAddCompletedMessage).toHaveBeenCalledTimes(1);
      const mirrored: ChatMessage = mockAddCompletedMessage.mock.calls[0][0];
      expect(mirrored.id).toBe('notice-stream');
      expect(mirrored.metadata).toEqual(notice.metadata);
      expect(mirrored.timestamp).toBeInstanceOf(Date);
    });

    it('drops the in-flight stream before mirroring so a late `complete` event cannot bury the notice', async () => {
      // When the agent emits its terminal `complete` event AFTER the rewind
      // response lands, `finalizeStream` would otherwise append the (now
      // rolled-back) assistant message past the notice — unlocking the Undo
      // button and hiding the rollback row from the tail. Clearing
      // activeStream first makes any late `complete` a no-op because
      // `finalizeStream` early-returns when activeStream is null.
      mockIsStreaming.value = true;

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      await waitFor(() => expect(mockRestoreMutate).toHaveBeenCalledTimes(1));
      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onSuccess(makeResult({ hasChanges: false, stashHash: null, notice: makeNotice() }));
      });

      expect(mockClearActiveStream).toHaveBeenCalledTimes(1);
      // Order matters: clearing must happen BEFORE the append, so the
      // appended notice isn't itself visible to a stale finalize call.
      expect(mockClearActiveStream.mock.invocationCallOrder[0])
        .toBeLessThan(mockAddCompletedMessage.mock.invocationCallOrder[0]);
    });

    it('still fires the rewind if stopGeneration rejects (transport error swallowed)', async () => {
      mockIsStreaming.value = true;
      mockStopGeneration.mockRejectedValueOnce(new Error('socket dropped'));

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      // Without the .catch() the rewind would never fire because the .then()
      // callback never runs on a rejected promise. The user clicked Undo —
      // the rewind must still happen even if the abort ack failed.
      await waitFor(() => expect(mockRestoreMutate).toHaveBeenCalledTimes(1));
    });

    it('still fires the rewind when stopGeneration never acks (timeout fallback)', async () => {
      vi.useFakeTimers();
      try {
        mockIsStreaming.value = true;
        mockStopGeneration.mockImplementationOnce(function () { return new Promise<void>(() => { /* never resolves */ }); });

        const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

        act(() => {
          result.current.triggerUndo();
        });

        // Pre-timeout: rewind must NOT have fired (we still respect the ack
        // when the server is just being slow).
        expect(mockRestoreMutate).not.toHaveBeenCalled();

        // Advance past the 5s ack timeout — the race resolves with 'timeout'
        // and the rewind fires anyway so Undo isn't silently dead.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });

        expect(mockRestoreMutate).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('idle branch — rewind directly', () => {
    it('does not call stopGeneration when the agent is idle', () => {
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      expect(mockStopGeneration).not.toHaveBeenCalled();
      expect(mockRestoreMutate).toHaveBeenCalledTimes(1);
      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({ appId: 'test-app-123' });
    });

    it('omits commitHash when no prompt has a captured pre-commit (stash-only)', () => {
      mockMessages.value = [
        { id: 'u1', role: 'user', content: 'hello', timestamp: new Date() } as ChatMessage,
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({ appId: 'test-app-123' });
    });

    it('skips mirroring when the response carries no notice (e.g. no active conversation)', () => {
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onSuccess(makeResult({ hasChanges: true, stashHash: 'stash-hash', notice: null }));
      });

      expect(mockAddCompletedMessage).not.toHaveBeenCalled();
      // Without a notice to mirror there's nothing for a late `complete` to
      // bury, so the stream-clear is also skipped — finalizeStream should
      // append the assistant turn normally.
      expect(mockClearActiveStream).not.toHaveBeenCalled();
    });
  });

  describe('rollback target resolution', () => {
    it("uses the parent of the responding assistant's commit as the rollback target", () => {
      // Most recent prompt was answered by an assistant whose commitHash is
      // `agent-commit`. The pre-prompt HEAD is its parent in git history —
      // that's what /git/restore should rewind to.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [variables, options] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'pre-prompt' });

      const notice = makeNotice({
        id: 'notice-restore',
        metadata: { kind: 'restore', commitHash: 'pre-prompt', stashHash: null, restoredCommitHash: 'pre-prompt' },
      });
      act(() => {
        options.onSuccess(makeResult({ hasChanges: false, stashHash: null, notice }));
      });
      expect(mockAddCompletedMessage).toHaveBeenCalledTimes(1);
      expect(mockAddCompletedMessage.mock.calls[0][0].id).toBe('notice-restore');
    });

    it('still resolves to the assistant commit\'s parent when an editor/asset commit landed between turns', () => {
      // Editor edits, asset uploads, and external git activity create commits
      // that never appear in the chat transcript. The parent-of-assistant
      // lookup uses the actual git DAG, so it returns the pre-prompt state
      // even with an extra `editor-commit` sitting on top of HEAD.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [
        makeCommit('editor-commit'),
        makeCommit('agent-commit'),
        makeCommit('pre-prompt'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [variables] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'pre-prompt' });
    });

    it('skips synthetic user-action notices when finding the prompt to undo', () => {
      // A prior undo inserted a user-action notice. We must skip it and find
      // the real prompt behind it. With no responding assistant for the most
      // recent prompt the target is null — server falls back to stash-only.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit-1'),
        undoNoticeMessage('n1', 'synthetic-hash'),
        userPromptMessage('u2'),
        assistantMessage('a2', 'agent-commit-2'),
      ];
      mockGitCommits.value = [
        makeCommit('agent-commit-2'),
        makeCommit('synthetic-hash'),
        makeCommit('agent-commit-1'),
        makeCommit('pre-u1'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [variables] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'synthetic-hash' });
    });

    it('omits commitHash when the responding assistant has no commit yet (in-flight or errored turn)', () => {
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1'),
      ];
      mockGitCommits.value = [makeCommit('previous-state')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      expect(mockRestoreMutate.mock.calls[0][0]).toEqual({ appId: 'test-app-123' });
    });
  });

  describe('user-stopped fallback', () => {
    // Stop creates a stop-squash commit on the server, but the commitHash
    // never reaches the client because the late terminal is suppressed by
    // the supersededSuccess gate (stop() vacates the activeStreams slot,
    // which the late path can't distinguish from a new-turn supersession).
    // The hook compensates by inferring the squash commit from git history
    // when the latest assistant turn is userStopped without a commitHash.

    it('unlocks after a stopped turn by inferring the squash commit at HEAD', () => {
      // HEAD is exactly one commit past the prior committed turn — that's
      // the stop-squash. Treat HEAD as the responding-assistant-commit and
      // rewind to its parent (= prior turn = pre-current-prompt state).
      mockMessages.value = [
        userPromptMessage('u-prev'),
        assistantMessage('a-prev', 'prior-commit'),
        userPromptMessage('u-stopped'),
        userStoppedAssistantMessage('a-stopped'),
      ];
      mockGitCommits.value = [
        makeCommit('stop-squash'),
        makeCommit('prior-commit'),
        makeCommit('pre-prior'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);

      act(() => {
        result.current.triggerUndo();
      });

      const [variables] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'prior-commit' });
    });

    it('locks when an editor commit landed on top of the stop-squash (drift)', () => {
      // commits[1] is the editor commit, commits[2] is the squash, commits[3]
      // is the prior turn — HEAD is two hops past prior, so we can't safely
      // assume commits[0] is ours. Fall back to Restore.
      mockMessages.value = [
        userPromptMessage('u-prev'),
        assistantMessage('a-prev', 'prior-commit'),
        userPromptMessage('u-stopped'),
        userStoppedAssistantMessage('a-stopped'),
      ];
      mockGitCommits.value = [
        makeCommit('editor-commit'),
        makeCommit('stop-squash'),
        makeCommit('prior-commit'),
        makeCommit('pre-prior'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks when no commit was created on stop (HEAD still at prior turn)', () => {
      // The agent didn't make any squashable changes before stop — HEAD is
      // still at the prior commit. There's nothing to undo.
      mockMessages.value = [
        userPromptMessage('u-prev'),
        assistantMessage('a-prev', 'prior-commit'),
        userPromptMessage('u-stopped'),
        userStoppedAssistantMessage('a-stopped'),
      ];
      mockGitCommits.value = [
        makeCommit('prior-commit'),
        makeCommit('pre-prior'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks the stopped first prompt with no prior committed turn (no anchor for drift check)', () => {
      // Without a prior commit anchor we can't tell the squash apart from
      // unrelated activity. Stay safe: lock and let Restore handle it.
      mockMessages.value = [
        userPromptMessage('u-stopped'),
        userStoppedAssistantMessage('a-stopped'),
      ];
      mockGitCommits.value = [
        makeCommit('stop-squash'),
        makeCommit('initial'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('uses the assistant\'s own commitHash when stop landed late enough to assign one', () => {
      // userStopped + a real commitHash on the message: take it directly,
      // no inference needed. (The fallback is only for the no-commitHash
      // user-stopped case caused by the supersededSuccess suppression.)
      const stopped = userStoppedAssistantMessage('a-stopped')
      ;(stopped as ChatMessage & { commitHash?: string }).commitHash = 'agent-commit'
      mockMessages.value = [
        userPromptMessage('u-stopped'),
        stopped,
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);

      act(() => {
        result.current.triggerUndo();
      });

      const [variables] = mockRestoreMutate.mock.calls[0];
      expect(variables).toEqual({ appId: 'test-app-123', commitHash: 'pre-prompt' });
    });
  });

  describe('error handling', () => {
    it('surfaces an error string when the rewind mutation fails', () => {
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onError(new Error('boom'));
      });

      expect(mockAddCompletedMessage).not.toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
    });

    it('clearError resets the error state', () => {
      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });
      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onError(new Error('boom'));
      });

      expect(result.current.error).toBeTruthy();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('lock after a restore notice', () => {
    it('locks the button when the most recent message is an undo notice', () => {
      // Stash-only undo notice — `kind: 'restore'` with no `restoredCommitHash`.
      mockMessages.value = [undoNoticeMessage('n1')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('locks the button when the most recent message is a restore notice', () => {
      // Per-prompt restore notice — `kind: 'restore'` with a `restoredCommitHash`.
      mockMessages.value = [restoreNoticeMessage('n1')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });

    it('unlocks once a new prompt is answered by a committed assistant turn at HEAD', () => {
      // After an undo, the next prompt's assistant response (with HEAD at
      // its commit and parent loaded) re-enables Undo for that new turn.
      mockMessages.value = [
        undoNoticeMessage('n1'),
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit-2'),
      ];
      mockGitCommits.value = [
        makeCommit('agent-commit-2'),
        makeCommit('pre-u1'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(false);
    });

    it('stays locked while the new prompt has no responding assistant commit yet', () => {
      // Mid-stream after a user types another prompt: no agent commit yet,
      // so there's nothing to undo. The button stays as Restore (locked).
      mockMessages.value = [
        undoNoticeMessage('n1'),
        userPromptMessage('u1'),
      ];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });
      expect(result.current.isLocked).toBe(true);
    });
  });

  describe('redo stack seeding', () => {
    it('pushes the pre-undo HEAD onto the redo stack on success', () => {
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'agent-commit'),
      ];
      mockGitCommits.value = [makeCommit('agent-commit'), makeCommit('pre-prompt')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      const notice = makeNotice({
        id: 'notice-undo',
        metadata: { kind: 'restore', commitHash: 'pre-prompt', stashHash: null, restoredCommitHash: 'pre-prompt' },
      });
      act(() => {
        options.onSuccess(makeResult({ notice }));
      });

      // Redo's forward target is the SHA HEAD pointed at right before the
      // rewind — `agent-commit`.
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['agent-commit']);
    });

    it('does not push when the rewind was stash-only (no restoredCommitHash)', () => {
      // Mid-stream undo with a dirty tree but no rollback target — server
      // stashes but doesn't rewind, so there is no forward path to record.
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1'),
      ];
      mockGitCommits.value = [makeCommit('previous-state')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      const notice = makeNotice({
        id: 'notice-stash-only',
        metadata: { kind: 'restore', commitHash: null, stashHash: 'stash-1' },
      });
      act(() => {
        options.onSuccess(makeResult({ hasChanges: true, stashHash: 'stash-1', notice }));
      });

      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual([]);
    });

    it('falls back to git HEAD when respondingAssistantCommit is missing', () => {
      // No responding assistant turn — but git HEAD is set. We still seed
      // the redo stack with HEAD so a subsequent Redo can step forward to
      // a SHA that's actually reachable on main. This avoids the old bug
      // where the chat-tracked SHA (a dangling session-branch commit on
      // local dev) would never let Redo find its way back.
      mockMessages.value = [userPromptMessage('u1')];
      mockGitCommits.value = [makeCommit('previous-state')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      const notice = makeNotice({
        id: 'notice-x',
        metadata: { kind: 'restore', commitHash: 'somewhere', stashHash: null, restoredCommitHash: 'somewhere' },
      });
      act(() => {
        options.onSuccess(makeResult({ notice }));
      });

      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['previous-state']);
    });

    it('sets the cursor to the previous chat-turn SHA, not the raw restoredCommitHash', () => {
      // Fix for the bug where `restoredCommitHash` (a non-chat-turn SHA on
      // local dev) was being written as the cursor, causing useHeadUndoAction
      // to silently re-anchor on the next Header Undo click.
      mockMessages.value = [
        userPromptMessage('u-old'),
        assistantMessage('a-old', 'previous-turn-sha'),
        userPromptMessage('u-new'),
        assistantMessage('a-new', 'latest-turn-sha'),
      ];
      mockGitCommits.value = [makeCommit('latest-turn-sha'), makeCommit('parent-of-latest')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      const notice = makeNotice({
        id: 'notice-undo',
        metadata: { kind: 'restore', commitHash: 'parent-of-latest', stashHash: null, restoredCommitHash: 'parent-of-latest' },
      });
      act(() => {
        options.onSuccess(makeResult({ notice }));
      });

      // Cursor must be the chat turn the user is now logically "at" —
      // i.e. the chat turn before the one we just undid.
      expect(useGitStore.getState().getUndoCursor('test-app-123')).toBe('previous-turn-sha');
      expect(useGitStore.getState().getUndoCursor('test-app-123')).not.toBe('parent-of-latest');
    });

    it('leaves cursor unset when there is no previous chat turn (undoing the first chat turn)', () => {
      mockMessages.value = [
        userPromptMessage('u1'),
        assistantMessage('a1', 'first-and-only-turn'),
      ];
      mockGitCommits.value = [makeCommit('first-and-only-turn'), makeCommit('pre-prompt')];

      const { result } = renderHook(() => useUndoAction(), { wrapper: createWrapper() });

      act(() => {
        result.current.triggerUndo();
      });

      const [, options] = mockRestoreMutate.mock.calls[0];
      act(() => {
        options.onSuccess(makeResult({
          notice: makeNotice({ id: 'n1', metadata: { kind: 'restore', commitHash: 'pre-prompt', stashHash: null, restoredCommitHash: 'pre-prompt' } }),
        }));
      });

      expect(useGitStore.getState().getUndoCursor('test-app-123')).toBeNull();
      expect(useGitStore.getState().getRedoStack('test-app-123')).toEqual(['first-and-only-turn']);
    });
  });
});
