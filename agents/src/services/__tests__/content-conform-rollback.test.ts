/**
 * Real rollback test (#12): verifies that when `tryConform` applies changes
 * (writes files) but `validateConform` then fails, ALL snapshotted files are
 * restored to their pre-conform content.
 *
 * The earlier "rolls back to no-op" test in content-conform-partial.test.ts
 * returns before the snapshot boundary (`hasExtractable=false`), so it never
 * exercises the write→validate-fail→restore path. This test does.
 *
 * Strategy: use a workspace whose `write` intercepts the page write and stores
 * garbage, so `validateConform` fails on "rewritten page does not import
 * virtual:content" after the content files are already written. We then assert
 * every snapshotted path is byte-restored to its original content.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateForWorkspace, WorkspaceClient } from '../../workspace/client.js';
import type { WriteOptions, WriteResult } from '../../workspace/files.js';
import { conformPageToContentLayer, type ConformOutcome } from '../content-conform.js';
import { TempWorkspaceFiles, tempWorkspaceFactory } from './temp-workspace-files.js';

// GitUtils is mocked so commitConform doesn't run in the rollback path
// (rollback returns null before the commit call).
vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.commitFilesIfChanged = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn().mockReturnValue({ tasks: {} }),
}));

const VITE_CONFIG: string = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

const EXTRACTABLE_PAGE: string = `const services = [
  { title: 'Web Design', desc: 'We build sites' },
  { title: 'SEO', desc: 'We rank sites' },
];

export default function ServicesPage() {
  return <div>{services.map((s) => <p key={s.title}>{s.desc}</p>)}</div>;
}
`;

let dir: string | undefined;

beforeEach(() => {
  dir = undefined;
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * A `TempWorkspaceFiles` subclass that intercepts the FIRST write to the page
 * path and stores garbage, causing `validateConform` to fail. Subsequent writes
 * to the page (the rollback restore) go through normally so the snapshot
 * restoration has effect. All other paths are always passed through.
 */
class CorruptingPageWorkspaceFiles extends TempWorkspaceFiles {
  private pageWriteCount: number = 0;

  constructor(
    root: string,
    private readonly pageRel: string,
  ) {
    super(root);
  }

  override async write(options: WriteOptions): Promise<WriteResult> {
    if (options.path === this.pageRel) {
      this.pageWriteCount += 1;
      if (this.pageWriteCount === 1) {
        // First write (the conform apply): corrupt it so validateConform fails.
        return super.write({ ...options, content: 'THIS IS NOT VALID TSX ;;; @@@' });
      }
      // Subsequent writes (rollback restore): pass through normally.
    }
    return super.write(options);
  }
}

describe('conformPageToContentLayer — real rollback (#12)', () => {
  it('restores all snapshotted files when validateConform fails after writes', async () => {
    const appPath: string = mkdtempSync(join(tmpdir(), 'conform-rollback-'));
    dir = appPath;
    mkdirSync(join(appPath, 'src', 'pages'), { recursive: true });
    writeFileSync(join(appPath, 'vite.config.ts'), VITE_CONFIG);
    writeFileSync(join(appPath, 'src', 'pages', 'services.tsx'), EXTRACTABLE_PAGE);

    const pageRel: string = 'src/pages/services.tsx';

    // Factory that wraps TempWorkspaceFiles with page-write corruption.
    const corruptingFactory: CreateForWorkspace = (): WorkspaceClient => {
      const files: CorruptingPageWorkspaceFiles = new CorruptingPageWorkspaceFiles(
        appPath,
        pageRel,
      );
      return new Proxy(
        { workspaceId: 'test', variant: 'preview', files } as unknown as WorkspaceClient,
        {
          get(target: WorkspaceClient, prop: string | symbol): unknown {
            if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop];
            throw new Error(`CorruptingWorkspaceClient: ${String(prop)} not implemented`);
          },
        },
      );
    };

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-rollback',
      appPath,
      fullPath: join(appPath, pageRel),
      command: 'create',
      isPageCreate: true,
      workspaceFactory: corruptingFactory,
    });

    // Conform must decline (validation failed → rollback).
    expect(outcome.note).toBeNull();

    // The page must be restored to its original pre-conform source.
    const pageAfter: string = readFileSync(join(appPath, pageRel), 'utf8');
    expect(pageAfter).toBe(EXTRACTABLE_PAGE);

    // The vite.config.ts must be restored to its original (no contentPlugin added).
    const viteAfter: string = readFileSync(join(appPath, 'vite.config.ts'), 'utf8');
    expect(viteAfter).toBe(VITE_CONFIG);
    expect(viteAfter).not.toContain('contentPlugin');

    // The content JSON must NOT exist (scaffold wrote it, rollback must delete it).
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(appPath, 'src', 'content', 'pages', 'services.json'))).toBe(false);
  });
});
