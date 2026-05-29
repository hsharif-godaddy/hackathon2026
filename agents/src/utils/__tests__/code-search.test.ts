import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn()
}));

vi.mock('../ripgrep-util.js', () => ({
  RipgrepUtil: {
    isAvailable: vi.fn(),
    search: vi.fn()
  }
}));

vi.mock('../file-search.js', () => ({
  FileSearch: {
    search: vi.fn()
  }
}));

vi.mock('../../tools/read-file.js', () => ({
  isFileBlocked: vi.fn(() => ({ blocked: false }))
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../logging/events/index.js', () => ({
  toolCodeSearchEvents: {
    fallback: vi.fn(),
    ripgrepError: vi.fn(),
    spawnError: vi.fn(),
    parseError: vi.fn()
  }
}));

import { searchCode } from '../code-search.js';
import { createForWorkspace } from '../../workspace/index.js';
import { RipgrepUtil } from '../ripgrep-util.js';
import { FileSearch } from '../file-search.js';

describe('code-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('#searchCode', () => {
    it('should pass "." to ripgrep instead of the host directory path', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      const mockWorkspace = { tasks: mockTasks };
      vi.mocked(createForWorkspace).mockReturnValue(mockWorkspace as any);
      vi.mocked(RipgrepUtil.isAvailable).mockResolvedValue(true);
      vi.mocked(RipgrepUtil.search).mockResolvedValue({
        matches: [],
        totalMatches: 0,
        truncated: false
      });

      await searchCode('app-123', '/tmp/airo-app-builder/app-123/preview', 'query');

      expect(RipgrepUtil.search).toHaveBeenCalledWith(
        mockTasks,
        '.',
        'query',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should use the host directory for the Node.js fallback', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);
      vi.mocked(FileSearch.search).mockResolvedValue({
        matches: [],
        totalMatches: 0,
        truncated: false
      });

      await searchCode('app-123', '/tmp/airo-app-builder/app-123/preview', 'query');

      expect(FileSearch.search).toHaveBeenCalledWith(
        '/tmp/airo-app-builder/app-123/preview',
        'query',
        expect.any(Object)
      );
    });

    it('should fall back to Node.js when ripgrep is not available', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      vi.mocked(createForWorkspace).mockReturnValue({ tasks: mockTasks } as any);
      vi.mocked(RipgrepUtil.isAvailable).mockResolvedValue(false);
      vi.mocked(FileSearch.search).mockResolvedValue({
        matches: [],
        totalMatches: 0,
        truncated: false
      });

      await searchCode('app-123', '/tmp/airo-app-builder/app-123/preview', 'query');

      expect(RipgrepUtil.search).not.toHaveBeenCalled();
      expect(FileSearch.search).toHaveBeenCalledWith(
        '/tmp/airo-app-builder/app-123/preview',
        'query',
        expect.any(Object)
      );
    });

    it('should propagate the error field from ripgrep results', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      vi.mocked(createForWorkspace).mockReturnValue({ tasks: mockTasks } as any);
      vi.mocked(RipgrepUtil.isAvailable).mockResolvedValue(true);
      vi.mocked(RipgrepUtil.search).mockResolvedValue({
        matches: [],
        totalMatches: 0,
        truncated: false,
        error: 'Search failed'
      });

      const result = await searchCode('app-123', '/host/path', 'query');

      expect(result.error).toBe('Search failed');
      expect(result.matches).toEqual([]);
    });

    it('should not include error field when ripgrep succeeds', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      vi.mocked(createForWorkspace).mockReturnValue({ tasks: mockTasks } as any);
      vi.mocked(RipgrepUtil.isAvailable).mockResolvedValue(true);
      vi.mocked(RipgrepUtil.search).mockResolvedValue({
        matches: [{ path: 'index.ts', line: 1, column: 1, text: 'test', matchStart: 0, matchEnd: 4, contextBefore: [], contextAfter: [] }],
        totalMatches: 1,
        truncated: false
      });

      const result = await searchCode('app-123', '/host/path', 'query');

      expect(result.error).toBeUndefined();
      expect(result.totalMatches).toBe(1);
    });

    it('should forward SearchOptions to ripgrep', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      vi.mocked(createForWorkspace).mockReturnValue({ tasks: mockTasks } as any);
      vi.mocked(RipgrepUtil.isAvailable).mockResolvedValue(true);
      vi.mocked(RipgrepUtil.search).mockResolvedValue({
        matches: [],
        totalMatches: 0,
        truncated: false
      });

      await searchCode('app-123', '/host/path', 'query', {
        caseSensitive: true,
        regex: true,
        maxResults: 25,
        filePattern: '*.tsx'
      });

      expect(RipgrepUtil.search).toHaveBeenCalledWith(
        mockTasks,
        '.',
        'query',
        {
          caseSensitive: true,
          regex: true,
          maxResults: 25,
          filePattern: '*.tsx'
        },
        expect.any(Function)
      );
    });
  });
});
