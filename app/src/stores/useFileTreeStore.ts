import { create } from 'zustand';

import type { FileItem } from '@/app/develop/components/FileTree';
import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

const MAX_RETRY_COUNT = 5;
const RETRY_DELAY_MS = 5000;

interface FileTreeState {
  // Per-app state
  files: Record<string, FileItem[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  retryCount: Record<string, number>;
  stoppedForAuth: Record<string, boolean>;
}

interface FileTreeActions {
  loadFiles: (appId: string) => Promise<void>;
  loadFilesFromCacheOrFetch: (appId: string) => Promise<void>;
  invalidate: (appId: string) => void;
  reset: (appId: string) => void;
  setFiles: (appId: string, files: FileItem[]) => void;
}

type FileTreeStore = FileTreeState & FileTreeActions;

// In-flight request tracking to prevent duplicate calls
const inflightRequests = new Map<string, Promise<void>>();

// Retry timeouts per app
const retryTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Build hierarchical file tree from flat list of entries
 */
function buildFileTree(entries: Array<{name: string; isDirectory: boolean; path: string; depth: number}>): FileItem[] {
  const tree: FileItem[] = [];
  const pathMap = new Map<string, FileItem>();

  const sortedEntries = entries.sort((a, b) => a.depth - b.depth);

  for (const entry of sortedEntries) {
    const item: FileItem = {
      name: entry.name,
      type: entry.isDirectory ? 'folder' : 'file',
      path: entry.path,
      extension: entry.isDirectory ? undefined : entry.name.split('.').pop(),
      children: entry.isDirectory ? [] : undefined
    };

    pathMap.set(entry.path, item);

    const parentPath = entry.path.split('/').slice(0, -1).join('/');
    const parent = parentPath ? pathMap.get(parentPath) : null;

    if (parent && parent.children) {
      parent.children.push(item);
    } else {
      // Entry is either root-level or orphaned (missing parent)
      if (parentPath) {
        logger.warn('file-tree.build.orphaned-entry', {
          path: entry.path,
          parentPath
        });
      }
      tree.push(item);
    }
  }

  return tree;
}

/**
 * Shared Zustand store for file tree state
 *
 * Centralizes file tree management across PreviewCode (desktop + mobile) and FileReferenceModal.
 * Prevents duplicate API calls and shares data across all consumers.
 */
export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  // Initial state
  files: {},
  loading: {},
  errors: {},
  retryCount: {},
  stoppedForAuth: {},

  /**
   * Load files for a specific app with deduplication and retry logic
   */
  loadFiles: async (appId: string) => {
    // Deduplication: if already loading, return existing promise
    if (inflightRequests.has(appId)) {
      return inflightRequests.get(appId);
    }

    // Clear any pending retry timeout
    const existingTimeout = retryTimeouts.get(appId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeouts.delete(appId);
    }

    // Create and track the load promise
    const loadPromise = (async () => {
      set((state) => ({
        loading: { ...state.loading, [appId]: true },
        errors: { ...state.errors, [appId]: null }
      }));

      try {
        const result = await appService.getFiles(appId, 5);

        // Success: reset retry count and stoppedForAuth flag
        set((state) => ({
          files: { ...state.files, [appId]: buildFileTree(result.entries || []) },
          loading: { ...state.loading, [appId]: false },
          retryCount: { ...state.retryCount, [appId]: 0 },
          stoppedForAuth: { ...state.stoppedForAuth, [appId]: false }
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        set((state) => ({
          errors: { ...state.errors, [appId]: errorMessage },
          loading: { ...state.loading, [appId]: false }
        }));

        // Auth-aware retry logic
        // Don't retry when auth has failed — AuthBoundary will prompt reauth
        if (useAuthUIStore.getState().needsReauth) {
          set((state) => ({
            stoppedForAuth: { ...state.stoppedForAuth, [appId]: true }
          }));
          return;
        }

        // Don't retry when tab is hidden
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }

        // Retry up to MAX_RETRY_COUNT times for transient errors
        const currentRetryCount = get().retryCount[appId] || 0;
        if (currentRetryCount < MAX_RETRY_COUNT) {
          set((state) => ({
            retryCount: { ...state.retryCount, [appId]: currentRetryCount + 1 }
          }));

          // Schedule retry
          const timeout = setTimeout(() => {
            retryTimeouts.delete(appId);
            inflightRequests.delete(appId);
            get().loadFiles(appId);
          }, RETRY_DELAY_MS);

          retryTimeouts.set(appId, timeout);
        }
      } finally {
        // Remove from in-flight tracking
        inflightRequests.delete(appId);
      }
    })();

    inflightRequests.set(appId, loadPromise);
    return loadPromise;
  },

  /**
   * Load files from cache if available, otherwise fetch from API
   * This is the recommended method for components to use - it ensures
   * only one API call per app across all consumers
   */
  loadFilesFromCacheOrFetch: async (appId: string) => {
    const { files, loading, stoppedForAuth } = get();

    // If files are already cached and not empty, return immediately
    // Apps are initialized from boilerplate templates that contain multiple files (package.json, index.html, etc.)
    // so an empty array always indicates an incomplete load or error state, never a valid cached state
    if (files[appId] && files[appId].length > 0) {
      return;
    }

    // If stopped for auth, don't retry until reauth completes
    if (stoppedForAuth[appId]) {
      return;
    }

    // If currently loading, wait for the existing load to complete
    if (loading[appId]) {
      const existing = inflightRequests.get(appId);
      if (existing) {
        return existing;
      }
    }

    // If there was an error but no retry in progress, allow retry
    // Otherwise fetch the files
    return get().loadFiles(appId);
  },

  /**
   * Invalidate cached files for an app (forces reload on next access)
   */
  invalidate: (appId: string) => {
    set((state) => ({
      files: { ...state.files, [appId]: [] },
      errors: { ...state.errors, [appId]: null },
      retryCount: { ...state.retryCount, [appId]: 0 }
    }));
  },

  /**
   * Reset all state for an app (cleanup on unmount/navigation)
   */
  reset: (appId: string) => {
    // Clear any pending retry timeout
    const existingTimeout = retryTimeouts.get(appId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeouts.delete(appId);
    }

    // Remove in-flight request
    inflightRequests.delete(appId);

    set((state) => {
      const newFiles = { ...state.files };
      const newLoading = { ...state.loading };
      const newErrors = { ...state.errors };
      const newRetryCount = { ...state.retryCount };
      const newStoppedForAuth = { ...state.stoppedForAuth };

      delete newFiles[appId];
      delete newLoading[appId];
      delete newErrors[appId];
      delete newRetryCount[appId];
      delete newStoppedForAuth[appId];

      return {
        files: newFiles,
        loading: newLoading,
        errors: newErrors,
        retryCount: newRetryCount,
        stoppedForAuth: newStoppedForAuth
      };
    });
  },

  /**
   * Set files directly (for testing or optimistic updates)
   */
  setFiles: (appId: string, files: FileItem[]) => {
    set((state) => ({
      files: { ...state.files, [appId]: files }
    }));
  }
}));

// Reauth recovery: when needsReauth clears, retry stopped loads
let _reauthUnsubscribe: (() => void) | null = null;

if (typeof window !== 'undefined') {
  let previousNeedsReauth = false;

  // Clean up any existing subscription (important for HMR in development)
  if (_reauthUnsubscribe) {
    _reauthUnsubscribe();
  }

  _reauthUnsubscribe = useAuthUIStore.subscribe((state) => {
    const currentNeedsReauth = state.needsReauth;

    // Detect transition from true → false (reauth completed)
    if (previousNeedsReauth && !currentNeedsReauth) {
      const { stoppedForAuth, loadFiles } = useFileTreeStore.getState();

      // Restart loads for any apps that stopped due to auth failure
      Object.keys(stoppedForAuth).forEach((appId) => {
        if (stoppedForAuth[appId]) {
          loadFiles(appId);
        }
      });
    }

    previousNeedsReauth = currentNeedsReauth;
  });
}
