import { describe, expect, it, vi } from 'vitest';
import { DirectoryListingTool, DirectoryListingNotFoundError } from '../directory-listing.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import type { TreeOptions, TreeResult, WorkspaceFiles } from '../../workspace/files.js';

vi.mock('../../logging/index.js', () => {
  const noop = vi.fn();
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    Logger: { create: vi.fn(() => ({ info: noop, warn: noop, error: noop, debug: noop })) },
  };
});

vi.mock('../../logging/events/index.js', () => ({
  toolDirectoryListingEvents: {
    begin: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
  },
}));

function makeTreeResult(entries: TreeResult['entries'], truncated = false): TreeResult {
  return { entries, truncated };
}

function makeFiles(impl: (opts?: TreeOptions) => Promise<TreeResult>): WorkspaceFiles {
  return { tree: vi.fn(impl) } as unknown as WorkspaceFiles;
}

describe('DirectoryListingTool', () => {
  describe('listDirectory', () => {
    it('returns entries from tree() with workspace-root paths and computed depth', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'index.ts', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'components', kind: 'directory', size: 0, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'components/Foo.tsx', kind: 'file', size: 200, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({ path: 'src' });

      expect(result.totalEntries).toBe(3);
      expect(result.fileCount).toBe(2);
      expect(result.directoryCount).toBe(1);
      expect(result.entries.map((e) => e.path)).toEqual([
        'src/index.ts',
        'src/components',
        'src/components/Foo.tsx',
      ]);
      expect(result.entries.find((e) => e.path === 'src/index.ts')?.depth).toBe(0);
      expect(result.entries.find((e) => e.path === 'src/components/Foo.tsx')?.depth).toBe(1);
    });

    it('passes default ignore patterns as excludeGlobs to dev-supervisor', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({});

      expect(treeFn).toHaveBeenCalledTimes(1);
      const opts = treeFn.mock.calls[0]?.[0];
      expect(opts?.excludeGlobs).toEqual(expect.arrayContaining(['node_modules', '.git', 'dist']));
    });

    it('disables default ignore patterns when disableDefaultIgnores is set', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({ disableDefaultIgnores: true, ignorePatterns: ['*.bak'] });

      const opts = treeFn.mock.calls[0]?.[0];
      expect(opts?.excludeGlobs).toEqual(['*.bak']);
    });

    it('maps maxDepth: 0 to a flat (non-recursive) listing', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({ maxDepth: 0 });

      const opts = treeFn.mock.calls[0]?.[0];
      expect(opts?.recursive).toBe(false);
      expect(opts?.maxDepth).toBeUndefined();
    });

    it('maps a finite maxDepth > 0 to recursive: true with the depth', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({ maxDepth: 3 });

      const opts = treeFn.mock.calls[0]?.[0];
      expect(opts?.recursive).toBe(true);
      expect(opts?.maxDepth).toBe(3);
    });

    it('maps Infinity (default) maxDepth to recursive: true with no maxDepth set', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({});

      const opts = treeFn.mock.calls[0]?.[0];
      expect(opts?.recursive).toBe(true);
      expect(opts?.maxDepth).toBeUndefined();
    });

    it('hides dotfile entries by default (any segment starting with .)', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'README.md', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: '.eslintrc', kind: 'file', size: 50, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src/.cache', kind: 'directory', size: 0, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({});

      expect(result.entries.map((e) => e.path)).toEqual(['README.md']);
    });

    it('includes hidden entries when showHidden is true', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'README.md', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: '.eslintrc', kind: 'file', size: 50, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({ showHidden: true });

      expect(result.entries.map((e) => e.path)).toEqual(['README.md', '.eslintrc']);
    });

    it('filters to directories when directoriesOnly is true', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'README.md', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src', kind: 'directory', size: 0, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({ directoriesOnly: true });

      expect(result.entries.map((e) => e.path)).toEqual(['src']);
      expect(result.fileCount).toBe(0);
      expect(result.directoryCount).toBe(1);
    });

    it('applies pattern (glob) filter to entry basenames', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'index.ts', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'README.md', kind: 'file', size: 50, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({ pattern: '*.md' });

      expect(result.entries.map((e) => e.path)).toEqual(['README.md']);
    });

    it('applies search (substring) filter to entry basenames', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'src/HomePage.tsx', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src/About.tsx', kind: 'file', size: 50, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({ search: 'home' });

      expect(result.entries.map((e) => e.path)).toEqual(['src/HomePage.tsx']);
    });

    it('propagates the truncated flag from tree()', async () => {
      const files = makeFiles(async () => makeTreeResult([], true));
      const tool = new DirectoryListingTool(files);
      const result = await tool.listDirectory({});

      expect(result.truncated).toBe(true);
    });

    it('throws DirectoryListingNotFoundError when tree() rejects with not_found', async () => {
      const files = makeFiles(async () => {
        throw new DevSupervisorError('not_found', 404, 'no such directory');
      });

      const tool = new DirectoryListingTool(files);
      const promise = tool.listDirectory({ path: 'missing' });
      await expect(promise).rejects.toBeInstanceOf(DirectoryListingNotFoundError);
      await expect(promise).rejects.toMatchObject({ path: 'missing' });
    });

    it('propagates non-not_found errors so transport failures are visible', async () => {
      const files = makeFiles(async () => {
        throw new DevSupervisorError('transport_error', 500, 'connection refused');
      });

      const tool = new DirectoryListingTool(files);
      await expect(tool.listDirectory({})).rejects.toThrow(DevSupervisorError);
    });

    it('normalizes leading and trailing slashes on the path argument', async () => {
      const files = makeFiles(async () =>
        makeTreeResult([
          { path: 'index.ts', kind: 'file', size: 100, modifiedAt: '2026-06-01T00:00:00Z' },
        ]),
      );

      const tool = new DirectoryListingTool(files);
      const slashed = await tool.listDirectory({ path: '/sub/' });
      const bare = await tool.listDirectory({ path: 'sub' });

      expect(slashed.entries[0]?.path).toBe('sub/index.ts');
      expect(bare.entries[0]?.path).toBe('sub/index.ts');
      expect(slashed.rootPath).toBe('sub');
      expect(bare.rootPath).toBe('sub');
    });

    it('treats an empty path the same as no path (workspace root)', async () => {
      const treeFn = vi.fn(async () => makeTreeResult([]));
      const tool = new DirectoryListingTool({ tree: treeFn } as unknown as WorkspaceFiles);

      await tool.listDirectory({ path: '' });
      const optsEmpty = treeFn.mock.calls[0]?.[0];
      await tool.listDirectory({});
      const optsAbsent = treeFn.mock.calls[1]?.[0];

      // Neither call should set `path` on the tree request — both are root-relative.
      expect(optsEmpty).not.toHaveProperty('path');
      expect(optsAbsent).not.toHaveProperty('path');
    });
  });
});
