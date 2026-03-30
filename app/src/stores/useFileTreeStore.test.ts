/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

// Mock appService - must be before imports
vi.mock('@/services/AppService', () => ({
  appService: {
    getFiles: vi.fn()
  }
}));

// Mock useAuthUIStore
const mockAuthState = { needsReauth: false };
vi.mock('@/stores/useAuthUIStore', () => {
  const subscribers: ((state: any) => void)[] = [];
  return {
    useAuthUIStore: {
      getState: () => mockAuthState,
      subscribe: (callback: (state: any) => void) => {
        subscribers.push(callback);
        return () => {
          const index = subscribers.indexOf(callback);
          if (index > -1) subscribers.splice(index, 1);
        };
      },
      _triggerSubscribers: () => {
        subscribers.forEach(sub => sub(mockAuthState));
      }
    }
  };
});

import type { FileItem } from '@/app/develop/components/FileTree';
import { useFileTreeStore } from './useFileTreeStore';

describe('useFileTreeStore', () => {
  let mockGetFiles: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { appService } = await import('@/services/AppService');
    mockGetFiles = vi.mocked(appService.getFiles);
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useFakeTimers();
    mockAuthState.needsReauth = false;

    // Reset store to initial state and clear module-level maps
    act(() => {
      // Reset all apps that might exist
      const currentState = useFileTreeStore.getState();
      Object.keys(currentState.files).forEach(appId => {
        useFileTreeStore.getState().reset(appId);
      });

      // Ensure clean slate
      useFileTreeStore.setState({
        files: {},
        loading: {},
        errors: {},
        retryCount: {},
        stoppedForAuth: {}
      });
    });

    // Set default successful mock
    mockGetFiles.mockResolvedValue({
      entries: [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 },
        { name: 'App.tsx', isDirectory: false, path: 'App.tsx', depth: 0 }
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadFiles', () => {
    it('should load files successfully', async () => {
      const mockEntries = [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 },
        { name: 'src', isDirectory: true, path: 'src', depth: 0 },
        { name: 'App.tsx', isDirectory: false, path: 'src/App.tsx', depth: 1 }
      ];

      mockGetFiles.mockResolvedValue({ entries: mockEntries });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      const state = useFileTreeStore.getState();
      expect(state.files['app1']).toBeDefined();
      expect(state.files['app1'].length).toBeGreaterThan(0);
      expect(state.loading['app1']).toBe(false);
      expect(state.errors['app1']).toBeNull();
      expect(mockGetFiles).toHaveBeenCalledWith('app1', 5);
    });

    it('should build hierarchical file tree correctly', async () => {
      const mockEntries = [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 },
        { name: 'src', isDirectory: true, path: 'src', depth: 0 },
        { name: 'components', isDirectory: true, path: 'src/components', depth: 1 },
        { name: 'Button.tsx', isDirectory: false, path: 'src/components/Button.tsx', depth: 2 },
        { name: 'utils', isDirectory: true, path: 'src/utils', depth: 1 },
        { name: 'helpers.ts', isDirectory: false, path: 'src/utils/helpers.ts', depth: 2 }
      ];

      mockGetFiles.mockResolvedValue({ entries: mockEntries });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      const state = useFileTreeStore.getState();
      const tree = state.files['app1'];

      // Should have 2 root items: index.tsx and src/
      expect(tree).toHaveLength(2);

      // Find root-level items
      const indexFile = tree.find((item: FileItem) => item.name === 'index.tsx');
      const srcFolder = tree.find((item: FileItem) => item.name === 'src');

      // Verify index.tsx structure
      expect(indexFile).toBeDefined();
      expect(indexFile?.type).toBe('file');
      expect(indexFile?.extension).toBe('tsx');
      expect(indexFile?.children).toBeUndefined();

      // Verify src/ folder structure
      expect(srcFolder).toBeDefined();
      expect(srcFolder?.type).toBe('folder');
      expect(srcFolder?.children).toBeDefined();
      expect(srcFolder?.children).toHaveLength(2);

      // Verify nested components/ folder
      const componentsFolder = srcFolder?.children?.find((item: FileItem) => item.name === 'components');
      expect(componentsFolder).toBeDefined();
      expect(componentsFolder?.type).toBe('folder');
      expect(componentsFolder?.children).toHaveLength(1);

      const buttonFile = componentsFolder?.children?.[0];
      expect(buttonFile?.name).toBe('Button.tsx');
      expect(buttonFile?.type).toBe('file');
      expect(buttonFile?.path).toBe('src/components/Button.tsx');

      // Verify nested utils/ folder
      const utilsFolder = srcFolder?.children?.find((item: FileItem) => item.name === 'utils');
      expect(utilsFolder).toBeDefined();
      expect(utilsFolder?.type).toBe('folder');
      expect(utilsFolder?.children).toHaveLength(1);

      const helpersFile = utilsFolder?.children?.[0];
      expect(helpersFile?.name).toBe('helpers.ts');
      expect(helpersFile?.type).toBe('file');
      expect(helpersFile?.extension).toBe('ts');
    });

    it('should handle empty entries list', async () => {
      mockGetFiles.mockResolvedValue({ entries: [] });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      const state = useFileTreeStore.getState();
      expect(state.files['app1']).toEqual([]);
      expect(state.loading['app1']).toBe(false);
      expect(state.errors['app1']).toBeNull();
    });

    it('should handle multiple apps simultaneously', async () => {
      const mockEntries1 = [
        { name: 'file1.txt', isDirectory: false, path: 'file1.txt', depth: 0 }
      ];
      const mockEntries2 = [
        { name: 'file2.txt', isDirectory: false, path: 'file2.txt', depth: 0 }
      ];

      mockGetFiles
        .mockResolvedValueOnce({ entries: mockEntries1 })
        .mockResolvedValueOnce({ entries: mockEntries2 });

      await act(async () => {
        await Promise.all([
          useFileTreeStore.getState().loadFiles('app1'),
          useFileTreeStore.getState().loadFiles('app2')
        ]);
      });

      const state = useFileTreeStore.getState();
      expect(state.files['app1']).toBeDefined();
      expect(state.files['app2']).toBeDefined();
      expect(mockGetFiles).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate concurrent calls for same app', async () => {
      const mockEntries = [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 }
      ];

      mockGetFiles.mockResolvedValue({ entries: mockEntries });

      // Make 3 concurrent calls for the same app
      await act(async () => {
        await Promise.all([
          useFileTreeStore.getState().loadFiles('app1'),
          useFileTreeStore.getState().loadFiles('app1'),
          useFileTreeStore.getState().loadFiles('app1')
        ]);
      });

      // Should only call API once due to deduplication
      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });

    it('should not retry when needsReauth is true', async () => {
      mockGetFiles.mockRejectedValue(new Error('Network error'));
      mockAuthState.needsReauth = true;

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      const state = useFileTreeStore.getState();
      expect(state.stoppedForAuth['app1']).toBe(true);
      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Advance time — no retry should happen
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });

    it('should retry up to MAX_RETRY_COUNT times on transient errors', async () => {
      mockGetFiles.mockClear();
      mockGetFiles.mockRejectedValue(new Error('Network error'));

      // Initial call
      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Retry 1
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(2);

      // Retry 2
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(3);

      // Retry 3
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(4);

      // Retry 4
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(5);

      // Retry 5
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(6);

      // No more retries after MAX_RETRY_COUNT (5)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(6);
    });

    it('should not retry when tab is hidden', async () => {
      mockGetFiles.mockRejectedValue(new Error('Network error'));

      const originalVisibilityState = document.visibilityState;
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true
      });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Advance time — no retry while tab is hidden
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Restore
      Object.defineProperty(document, 'visibilityState', {
        value: originalVisibilityState,
        writable: true,
        configurable: true
      });
    });

    it('should reset retry count on successful load', async () => {
      // First call fails
      mockGetFiles.mockRejectedValueOnce(new Error('Network error'));
      // Second call (retry) succeeds
      mockGetFiles.mockResolvedValueOnce({
        entries: [{ name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 }]
      });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Retry succeeds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(2);

      const state = useFileTreeStore.getState();
      expect(state.retryCount['app1']).toBe(0);
      expect(state.stoppedForAuth['app1']).toBe(false);
    });

    it('should mark stoppedForAuth when auth fails', async () => {
      mockGetFiles.mockRejectedValue(new Error('Auth required'));
      mockAuthState.needsReauth = true;

      // Initial load fails with auth error
      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);
      expect(useFileTreeStore.getState().stoppedForAuth['app1']).toBe(true);

      // Verify no retries happen
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate', () => {
    it('should clear files for an app', async () => {
      const mockEntries = [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 }
      ];

      mockGetFiles.mockResolvedValue({ entries: mockEntries });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      expect(useFileTreeStore.getState().files['app1'].length).toBeGreaterThan(0);

      act(() => {
        useFileTreeStore.getState().invalidate('app1');
      });

      const state = useFileTreeStore.getState();
      expect(state.files['app1']).toEqual([]);
      expect(state.errors['app1']).toBeNull();
      expect(state.retryCount['app1']).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all state for an app', async () => {
      const mockEntries = [
        { name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 }
      ];

      mockGetFiles.mockResolvedValue({ entries: mockEntries });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      act(() => {
        useFileTreeStore.getState().reset('app1');
      });

      const state = useFileTreeStore.getState();
      expect(state.files['app1']).toBeUndefined();
      expect(state.loading['app1']).toBeUndefined();
      expect(state.errors['app1']).toBeUndefined();
      expect(state.retryCount['app1']).toBeUndefined();
      expect(state.stoppedForAuth['app1']).toBeUndefined();
    });

    it('should clear pending retry timeouts', async () => {
      mockGetFiles.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      // Reset before retry fires
      act(() => {
        useFileTreeStore.getState().reset('app1');
      });

      // Advance time
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // Should not have retried (timeout was cleared)
      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('setFiles', () => {
    it('should set files directly', () => {
      const testFiles = [
        { name: 'test.txt', type: 'file' as const, path: 'test.txt' }
      ];

      act(() => {
        useFileTreeStore.getState().setFiles('app1', testFiles);
      });

      expect(useFileTreeStore.getState().files['app1']).toEqual(testFiles);
    });
  });

  describe('loadFilesFromCacheOrFetch', () => {
    it('should load files from API when cache is empty', async () => {
      await act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      expect(mockGetFiles).toHaveBeenCalledWith('app1', 5);
      expect(useFileTreeStore.getState().files['app1']).toHaveLength(2);
    });

    it('should return cached files without API call', async () => {
      const cachedFiles = [
        { name: 'cached.txt', type: 'file' as const, path: 'cached.txt' }
      ];

      act(() => {
        useFileTreeStore.getState().setFiles('app1', cachedFiles);
      });

      mockGetFiles.mockClear();

      await act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      expect(mockGetFiles).not.toHaveBeenCalled();
      expect(useFileTreeStore.getState().files['app1']).toEqual(cachedFiles);
    });

    it('should wait for in-flight request if already loading', async () => {
      const firstCall = act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      const secondCall = act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      await Promise.all([firstCall, secondCall]);

      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });

    it('should fetch if cache is empty array', async () => {
      act(() => {
        useFileTreeStore.getState().setFiles('app1', []);
      });

      await act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      expect(mockGetFiles).toHaveBeenCalledWith('app1', 5);
    });

    it('should not fetch if app is stopped for auth', async () => {
      // Mark app as stopped for auth
      act(() => {
        useFileTreeStore.setState({
          stoppedForAuth: { 'app1': true }
        });
      });

      mockGetFiles.mockClear();

      await act(async () => {
        await useFileTreeStore.getState().loadFilesFromCacheOrFetch('app1');
      });

      expect(mockGetFiles).not.toHaveBeenCalled();
    });
  });

  describe('reauth recovery', () => {
    it('should retry stopped loads when reauth completes', async () => {
      const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

      // Simulate auth failure
      mockGetFiles.mockRejectedValue(new Error('Auth required'));
      mockAuthState.needsReauth = true;

      // First trigger subscribers with needsReauth=true so the subscription's previousNeedsReauth captures it
      await act(async () => {
        (useAuthUIStore as any)._triggerSubscribers();
      });

      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1').catch(() => {});
      });

      expect(useFileTreeStore.getState().stoppedForAuth['app1']).toBe(true);
      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      // Now simulate successful reauth
      mockGetFiles.mockClear();
      mockGetFiles.mockResolvedValue({
        entries: [{ name: 'index.tsx', isDirectory: false, path: 'index.tsx', depth: 0 }]
      });

      // Trigger reauth completion by updating needsReauth (true→false transition)
      await act(async () => {
        mockAuthState.needsReauth = false;
        (useAuthUIStore as any)._triggerSubscribers();
      });

      // Should have retried the load
      expect(mockGetFiles).toHaveBeenCalledWith('app1', 5);
      expect(useFileTreeStore.getState().stoppedForAuth['app1']).toBe(false);
    });

    it('should not retry loads that were not stopped for auth', async () => {
      const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

      // Simulate successful load
      await act(async () => {
        await useFileTreeStore.getState().loadFiles('app1');
      });

      expect(useFileTreeStore.getState().stoppedForAuth['app1']).toBe(false);

      mockGetFiles.mockClear();

      // Trigger reauth completion
      await act(async () => {
        mockAuthState.needsReauth = false;
        (useAuthUIStore as any)._triggerSubscribers();
      });

      // Should not have made additional calls
      expect(mockGetFiles).not.toHaveBeenCalled();
    });
  });
});
