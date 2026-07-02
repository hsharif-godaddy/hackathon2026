import { describe, expect, it, vi } from 'vitest';
import { validateLucideIcons } from '../icons-validator.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import type {
  StatResult,
  TreeOptions,
  TreeResult,
  WorkspaceFiles,
} from '../../workspace/files.js';

/**
 * Strict WorkspaceFiles mock: only the methods icons-validator is allowed to
 * touch (`tree`, `stat`, `view`, `readText`) are implemented. Every other
 * member throws, so an accidental host-fs-style access or unexpected call
 * fails loudly.
 */
function makeFiles(overrides: Partial<WorkspaceFiles>): WorkspaceFiles {
  const defaults: Partial<WorkspaceFiles> = {
    readText: (async () => '') as WorkspaceFiles['readText'],
  };
  const merged: Partial<WorkspaceFiles> = { ...defaults, ...overrides };
  return new Proxy(merged, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof WorkspaceFiles];
      return () => {
        throw new Error(`unexpected WorkspaceFiles.${String(prop)} call`);
      };
    },
  }) as WorkspaceFiles;
}


const VALID_IMPORT = `import { Check, Circle } from 'lucide-react';\nexport const A = 1;\n`;
const INVALID_IMPORT = `import { NotARealIconXyz } from 'lucide-react';\n`;
const NO_ICONS = `export const noIcons = true;\n`;

describe('validateLucideIcons', () => {
  it('walks the workspace via tree with file-only, extension-scoped, pruned globs', async () => {
    const tree = vi.fn(
      async (): Promise<TreeResult> => ({
        entries: [{ path: 'src/App.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' }],
        truncated: false,
      }),
    );
    const readText = vi.fn(async () => VALID_IMPORT);
    const files = makeFiles({ tree, readText });

    const result = await validateLucideIcons(files);

    const opts = tree.mock.calls[0]?.[0] as TreeOptions;
    expect(opts.recursive).toBe(true);
    expect(opts.kindFilter).toBe('file');
    expect(opts.includeGlobs).toEqual(['*.tsx', '*.ts', '*.jsx', '*.js']);
    expect(opts.excludeGlobs).toEqual(
      expect.arrayContaining(['node_modules', '.git', 'dist', 'build']),
    );
    expect(result.valid).toBe(true);
    expect(result.scannedFiles).toEqual(['src/App.tsx']);
  });

  it('flags an invalid icon with a fix suggestion', async () => {
    const files = makeFiles({
      tree: async () => ({
        entries: [{ path: 'src/Bad.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' }],
        truncated: false,
      }),
      readText: async () => INVALID_IMPORT,
    });

    const result = await validateLucideIcons(files);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: 'src/Bad.tsx', icon: 'NotARealIconXyz', line: 1 });
    expect(result.fixSuggestions.some((s) => s.includes('src/Bad.tsx:1'))).toBe(true);
  });

  it('resolves explicit files via stat, keeping only existing regular files', async () => {
    const stat = vi.fn(
      async (): Promise<StatResult> => ({
        entries: [
          { path: 'src/A.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src/dir', kind: 'directory', size: 0, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src/missing.tsx', error: 'not_found' },
        ],
      }),
    );
    const readText = vi.fn(async () => VALID_IMPORT);
    const files = makeFiles({ stat, readText });

    const result = await validateLucideIcons(files, ['src/A.tsx', 'src/dir', 'src/missing.tsx']);

    expect(stat).toHaveBeenCalledWith({ paths: ['src/A.tsx', 'src/dir', 'src/missing.tsx'] });
    // Only the regular file is scanned; the directory and missing path drop out.
    expect(result.scannedFiles).toEqual(['src/A.tsx']);
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('returns a single warning (valid) when nothing matches', async () => {
    const files = makeFiles({
      tree: async () => ({ entries: [], truncated: false }),
    });

    const result = await validateLucideIcons(files);

    expect(result.valid).toBe(true);
    expect(result.scannedFiles).toEqual([]);
    expect(result.warnings).toEqual([
      { file: 'project', message: 'No React/TypeScript files found to scan' },
    ]);
  });

  it('warns when the recursive scan was truncated at the workspace limit', async () => {
    const files = makeFiles({
      tree: async () => ({
        entries: [{ path: 'src/App.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' }],
        truncated: true,
      }),
      readText: async () => VALID_IMPORT,
    });

    const result = await validateLucideIcons(files);

    // Truncation is a warning, not a hard failure — valid still reflects icons.
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual({
      file: 'project',
      message: 'File scan truncated at the workspace limit; not all files were validated',
    });
  });

  it('reads every file and aggregates errors across concurrency batches', async () => {
    // 25 files > FILE_READ_CONCURRENCY (10) → 3 batches. The only invalid icon
    // lives in the third batch, so passing it proves cross-batch aggregation
    // and that every file is read (not just the first batch).
    const paths = Array.from({ length: 25 }, (_, i) => `src/f${String(i).padStart(2, '0')}.tsx`);
    const badPath = paths[20]!;
    const readText = vi.fn(async ({ path }: { path: string }) =>
      path === badPath ? INVALID_IMPORT : VALID_IMPORT,
    );
    const files = makeFiles({
      tree: async () => ({
        entries: paths.map((path) => ({ path, kind: 'file' as const, size: 10, modifiedAt: '2026-06-01T00:00:00Z' })),
        truncated: false,
      }),
      readText,
    });

    const result = await validateLucideIcons(files);

    expect(readText).toHaveBeenCalledTimes(25);
    expect(result.scannedFiles).toHaveLength(25);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe(badPath);
  });

  it('skips files with no lucide imports without recording errors', async () => {
    const files = makeFiles({
      tree: async () => ({
        entries: [{ path: 'src/Plain.ts', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' }],
        truncated: false,
      }),
      readText: async () => NO_ICONS,
    });

    const result = await validateLucideIcons(files);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('downgrades a per-file not_found to a warning and keeps validating others', async () => {
    const files = makeFiles({
      tree: async () => ({
        entries: [
          { path: 'src/Gone.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' },
          { path: 'src/Bad.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' },
        ],
        truncated: false,
      }),
      readText: vi.fn(async ({ path }: { path: string }) => {
        if (path === 'src/Gone.tsx') {
          throw new DevSupervisorError('not_found', 404, 'gone');
        }
        return INVALID_IMPORT;
      }),
    });

    const result = await validateLucideIcons(files);

    expect(result.warnings).toContainEqual({ file: 'src/Gone.tsx', message: 'Could not read file: not found' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe('src/Bad.tsx');
  });

  it('propagates a per-file transport error instead of masking it', async () => {
    const files = makeFiles({
      tree: async () => ({
        entries: [{ path: 'src/A.tsx', kind: 'file', size: 10, modifiedAt: '2026-06-01T00:00:00Z' }],
        truncated: false,
      }),
      readText: async () => {
        throw new DevSupervisorError('transport_error', 500, 'connection refused');
      },
    });

    await expect(validateLucideIcons(files)).rejects.toThrow(DevSupervisorError);
  });

  it('propagates a scan (tree) transport error', async () => {
    const files = makeFiles({
      tree: async () => {
        throw new DevSupervisorError('transport_error', 500, 'connection refused');
      },
    });

    await expect(validateLucideIcons(files)).rejects.toThrow(DevSupervisorError);
  });
});
