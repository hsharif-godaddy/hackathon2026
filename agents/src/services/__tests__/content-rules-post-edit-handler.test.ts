import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockReadFile, mockCheckContentRulesForFile, mockLoggerWarn } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockCheckContentRulesForFile: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

vi.mock('../../tools/content-rules-lint.js', () => ({
  checkContentRulesForFile: mockCheckContentRulesForFile,
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

import type { RuleViolation } from '../../tools/content-rules-lint.js';
import type { PostEditContext } from '../../tools/ai-lib-tools/post-edit-handlers.js';
import { contentRulesPostEditHandler } from '../content-rules-post-edit-handler.js';

const APP_PATH = '/tmp/app';

function makeContext(relPath: string): PostEditContext {
  return {
    fullPath: `${APP_PATH}/${relPath}`,
    filePath: relPath,
    appPath: APP_PATH,
    appId: 'app-abc',
    command: 'create',
  };
}

describe('contentRulesPostEditHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckContentRulesForFile.mockReturnValue([]);
    mockReadFile.mockResolvedValue('export default function Page() { return null; }');
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

      const result = await contentRulesPostEditHandler.run(makeContext('src/pages/index.tsx'), 'File created successfully.');

      expect(result).toContain('File created successfully.');
      expect(result).toContain('missed-content-opportunity');
      expect(result).toContain('page has inline text but no import from "virtual:content"');
      // original result preserved at the top
      expect(result.startsWith('File created successfully.')).toBe(true);
    });

    it('returns the result unchanged when the file is clean', async () => {
      mockCheckContentRulesForFile.mockReturnValue([]);
      const result = await contentRulesPostEditHandler.run(makeContext('src/pages/index.tsx'), 'File created successfully.');
      expect(result).toBe('File created successfully.');
    });

    it('does not fail the write when reading the file throws', async () => {
      mockReadFile.mockRejectedValue(new Error('boom'));
      const result = await contentRulesPostEditHandler.run(makeContext('src/pages/index.tsx'), 'File created successfully.');
      expect(result).toBe('File created successfully.');
      expect(mockCheckContentRulesForFile).not.toHaveBeenCalled();
    });

    it('does not fail the write when the linter throws', async () => {
      mockCheckContentRulesForFile.mockImplementation(() => {
        throw new Error('parser exploded');
      });
      const result = await contentRulesPostEditHandler.run(makeContext('src/pages/index.tsx'), 'File created successfully.');
      expect(result).toBe('File created successfully.');
      expect(mockLoggerWarn).toHaveBeenCalled();
    });
  });
});
