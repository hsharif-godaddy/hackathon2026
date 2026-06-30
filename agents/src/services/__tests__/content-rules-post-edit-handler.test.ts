import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCheckContentRulesForFile, mockLoggerWarn } = vi.hoisted(() => ({
  mockCheckContentRulesForFile: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('../../tools/content-rules-lint.js', () => ({
  checkContentRulesForFile: mockCheckContentRulesForFile,
}));

vi.mock('../../logging/index.js', () => {
  const loggerStub = { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn(), debug: vi.fn() };
  return {
    logger: loggerStub,
    // content-conform pulls in content-scaffold → content-user-edits, which
    // calls Logger.create(); provide it so the import graph resolves.
    Logger: { create: () => loggerStub },
  };
});

import type { RuleViolation } from '../../tools/content-rules-lint.js';
import type { PostEditContext } from '../../tools/ai-lib-tools/post-edit-handlers.js';
import type { CreateForWorkspace, WorkspaceClient } from '../../workspace/client.js';
import type { StatOptions, StatResult, ViewOptions, ViewResult, WorkspaceFiles } from '../../workspace/files.js';
import {
  contentRulesPostEditHandler,
  createContentRulesPostEditHandler,
} from '../content-rules-post-edit-handler.js';

const APP_PATH: string = '/tmp/app';

/**
 * In-memory `WorkspaceFiles` for the advisory-path tests: the handler now reads
 * the edited file through the Workspace API (not node:fs), so we back it with a
 * fixed file map. `pageReader` lets a test force a read failure.
 */
function memoryFactory(
  files: Record<string, string>,
  pageReader?: () => Promise<string>,
): CreateForWorkspace {
  const api = {
    async stat(options: StatOptions): Promise<StatResult> {
      return {
        entries: options.paths.map((p: string) =>
          p in files
            ? { path: p, kind: 'file' as const, size: files[p]!.length, modifiedAt: '2026-01-01T00:00:00.000Z' }
            : { path: p, error: 'not_found' as const },
        ),
      };
    },
    async view(options: ViewOptions): Promise<ViewResult> {
      const content: string = pageReader ? await pageReader() : (files[options.path] ?? '');
      return { path: options.path, content, encoding: 'utf-8', lines: 1, size: content.length, truncated: false };
    },
  } as unknown as WorkspaceFiles;
  return (): WorkspaceClient => ({ files: api } as unknown as WorkspaceClient);
}

const PAGE_SOURCE: string = 'export default function Page() { return null; }';

function makeContext(relPath: string): PostEditContext {
  return {
    fullPath: `${APP_PATH}/${relPath}`,
    filePath: relPath,
    appPath: APP_PATH,
    appId: 'app-abc',
    command: 'create',
  };
}

function handlerReading(source: string, pageReader?: () => Promise<string>) {
  return createContentRulesPostEditHandler({
    workspaceFactory: memoryFactory({ 'src/pages/index.tsx': source }, pageReader),
  });
}

describe('contentRulesPostEditHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckContentRulesForFile.mockReturnValue([]);
  });

  describe('matches', () => {
    it('matches .tsx page files', () => {
      expect(contentRulesPostEditHandler.matches('src/pages/index.tsx', makeContext('src/pages/index.tsx'))).toBe(true);
    });

    it('matches .ts files', () => {
      expect(contentRulesPostEditHandler.matches('src/lib/util.ts', makeContext('src/lib/util.ts'))).toBe(true);
    });

    it('does not match non-ts/tsx files', () => {
      expect(contentRulesPostEditHandler.matches('src/styles/app.css', makeContext('src/styles/app.css'))).toBe(false);
      expect(contentRulesPostEditHandler.matches('public/data.json', makeContext('public/data.json'))).toBe(false);
    });

    it('does not match files under src/content/', () => {
      expect(contentRulesPostEditHandler.matches('src/content/index.ts', makeContext('src/content/index.ts'))).toBe(false);
      expect(contentRulesPostEditHandler.matches('src/content/home/index.json', makeContext('src/content/home/index.json'))).toBe(false);
    });
  });

  describe('run', () => {
    it('appends violations to the result when the linter finds them', async () => {
      const violations: RuleViolation[] = [
        {
          rule: 'missed-content-opportunity',
          file: 'src/pages/index.tsx',
          line: 4,
          message: 'page has inline text but no import from "virtual:content"',
        },
      ];
      mockCheckContentRulesForFile.mockReturnValue(violations);

      const result: string = await handlerReading(PAGE_SOURCE).run(
        makeContext('src/pages/index.tsx'),
        'File created successfully.',
      );

      expect(result).toContain('File created successfully.');
      expect(result).toContain('missed-content-opportunity');
      expect(result).toContain('page has inline text but no import from "virtual:content"');
      expect(result.startsWith('File created successfully.')).toBe(true);
    });

    it('returns the result unchanged when the file is clean', async () => {
      mockCheckContentRulesForFile.mockReturnValue([]);
      const result: string = await handlerReading(PAGE_SOURCE).run(
        makeContext('src/pages/index.tsx'),
        'File created successfully.',
      );
      expect(result).toBe('File created successfully.');
    });

    it('does not fail the write when reading the file throws', async () => {
      const result: string = await handlerReading(PAGE_SOURCE, () => Promise.reject(new Error('boom'))).run(
        makeContext('src/pages/index.tsx'),
        'File created successfully.',
      );
      expect(result).toBe('File created successfully.');
      expect(mockCheckContentRulesForFile).not.toHaveBeenCalled();
    });

    it('does not fail the write when the linter throws', async () => {
      mockCheckContentRulesForFile.mockImplementation(() => {
        throw new Error('parser exploded');
      });
      const result: string = await handlerReading(PAGE_SOURCE).run(
        makeContext('src/pages/index.tsx'),
        'File created successfully.',
      );
      expect(result).toBe('File created successfully.');
      expect(mockLoggerWarn).toHaveBeenCalled();
    });
  });
});
