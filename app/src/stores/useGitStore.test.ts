/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentTokenAcquisitionError } from '@/lib/agent-fetch';
import { appService } from '@/services/AppService';
import { useGitStore } from './useGitStore';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/services/AppService', () => ({
  appService: {
    checkoutCommit: vi.fn(),
    returnToMainBranch: vi.fn(),
  },
}));

const APP_ID = 'app-test';

describe('useGitStore — redo stack', () => {
  beforeEach(() => {
    useGitStore.getState().clearAppState(APP_ID);
  });

  describe('pushRedo / popRedo / getRedoStack', () => {
    it('pushes entries and reads them back in LIFO order', () => {
      const { pushRedo, popRedo, getRedoStack } = useGitStore.getState();
      pushRedo(APP_ID, 'sha-a');
      pushRedo(APP_ID, 'sha-b');

      expect(getRedoStack(APP_ID)).toEqual(['sha-a', 'sha-b']);
      expect(popRedo(APP_ID)).toBe('sha-b');
      expect(popRedo(APP_ID)).toBe('sha-a');
      expect(popRedo(APP_ID)).toBeNull();
    });

    it('returns an empty stack for an unknown app', () => {
      expect(useGitStore.getState().getRedoStack('never-touched')).toEqual([]);
    });

    it('keeps stacks isolated per app', () => {
      const { pushRedo, getRedoStack, popRedo } = useGitStore.getState();
      pushRedo('app-1', 'one');
      pushRedo('app-2', 'two');

      expect(getRedoStack('app-1')).toEqual(['one']);
      expect(getRedoStack('app-2')).toEqual(['two']);
      popRedo('app-1');
      expect(getRedoStack('app-1')).toEqual([]);
      expect(getRedoStack('app-2')).toEqual(['two']);

      // Cleanup so other tests in the file aren't polluted.
      useGitStore.getState().clearAppState('app-1');
      useGitStore.getState().clearAppState('app-2');
    });
  });

  describe('clearRedoStack', () => {
    it('clears the stack', () => {
      const { pushRedo, clearRedoStack, getRedoStack } = useGitStore.getState();
      pushRedo(APP_ID, 'a');
      pushRedo(APP_ID, 'b');

      clearRedoStack(APP_ID);

      expect(getRedoStack(APP_ID)).toEqual([]);
    });
  });

  describe('undo cursor', () => {
    it('round-trips a SHA', () => {
      useGitStore.getState().setUndoCursor(APP_ID, 'cursor-sha');
      expect(useGitStore.getState().getUndoCursor(APP_ID)).toBe('cursor-sha');
    });

    it('returns null for an unset app', () => {
      expect(useGitStore.getState().getUndoCursor('never-set')).toBeNull();
    });

    it('overwrites the previous cursor on subsequent calls', () => {
      const { setUndoCursor, getUndoCursor } = useGitStore.getState();
      setUndoCursor(APP_ID, 'first');
      setUndoCursor(APP_ID, 'second');
      expect(getUndoCursor(APP_ID)).toBe('second');
    });
  });

  describe('clearAppState', () => {
    it('drops the redo stack, undo cursor, and selection state together', () => {
      const { pushRedo, setSelectedCommitHash, setUndoCursor, clearAppState, getRedoStack, getSelectedCommitHash, getUndoCursor } =
        useGitStore.getState();
      pushRedo(APP_ID, 'r1');
      setSelectedCommitHash(APP_ID, 's1');
      setUndoCursor(APP_ID, 'c1');

      clearAppState(APP_ID);

      expect(getRedoStack(APP_ID)).toEqual([]);
      expect(getSelectedCommitHash(APP_ID)).toBeNull();
      expect(getUndoCursor(APP_ID)).toBeNull();
    });
  });
});

describe('useGitStore — commit selection errors', () => {
  beforeEach(() => {
    useGitStore.setState({
      commitSelectionError: null,
      commitSelectionAuthError: false,
      isSelectingCommit: false,
    });
    vi.clearAllMocks();
  });

  describe('selectCommit', () => {
    it('sets commitSelectionAuthError when token acquisition fails', async function authFailure() {
      vi.mocked(appService.checkoutCommit).mockRejectedValueOnce(
        new AgentTokenAcquisitionError('auth_failed', 'Failed to get agent token: 401'),
      );

      await expect(useGitStore.getState().selectCommit(APP_ID, 'abc1234')).rejects.toThrow();

      expect(useGitStore.getState().commitSelectionAuthError).toBe(true);
      expect(useGitStore.getState().commitSelectionError).toContain('401');
    });

    it('leaves commitSelectionAuthError false for generic failures', async function genericFailure() {
      vi.mocked(appService.checkoutCommit).mockRejectedValueOnce(new Error('Failed to checkout: 400'));

      await expect(useGitStore.getState().selectCommit(APP_ID, 'abc1234')).rejects.toThrow();

      expect(useGitStore.getState().commitSelectionAuthError).toBe(false);
    });
  });

  describe('returnToMain', () => {
    it('sets commitSelectionAuthError and re-throws on auth failure', async function authFailure() {
      vi.mocked(appService.returnToMainBranch).mockRejectedValueOnce(
        new AgentTokenAcquisitionError('auth_dismissed', 'Authentication dismissed'),
      );

      await expect(useGitStore.getState().returnToMain(APP_ID, 'latest1')).rejects.toThrow();

      expect(useGitStore.getState().commitSelectionAuthError).toBe(true);
    });

    it('leaves commitSelectionAuthError false for generic failures', async function genericFailure() {
      vi.mocked(appService.returnToMainBranch).mockRejectedValueOnce(new Error('Failed to return: 500'));

      await expect(useGitStore.getState().returnToMain(APP_ID, 'latest1')).rejects.toThrow();

      expect(useGitStore.getState().commitSelectionAuthError).toBe(false);
    });
  });
});
