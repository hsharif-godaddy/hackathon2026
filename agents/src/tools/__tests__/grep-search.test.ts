import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindById, mockCreateSupervisor, mockRipgrepSearch } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockCreateSupervisor: vi.fn(),
  mockRipgrepSearch: vi.fn(),
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById
  }))
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  createDevSupervisorClientForApp: mockCreateSupervisor
}));

vi.mock('../../utils/ripgrep-util.js', () => ({
  RipgrepUtil: {
    search: mockRipgrepSearch
  }
}));

vi.mock('../../utils/path-helper.js', async () => {
  const nodePath = await import('node:path');
  return {
    isPathSafe: vi.fn().mockImplementation((filePath: string, appPath: string) => {
      const resolved = nodePath.resolve(filePath);
      const rel = nodePath.relative(appPath, resolved);
      return rel !== '..' && !rel.startsWith(`..${nodePath.sep}`);
    }),
    deriveAssetsDir: vi.fn().mockReturnValue(null),
    validateNoEscapingSymlinks: vi.fn()
  };
});

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import { grepSearchAITool, grepSearchSchema } from '../ai-lib-tools/grep-search';

async function executeTool(input: Record<string, unknown>, appId?: string): Promise<string> {
  const toolObj = grepSearchAITool as { execute: (input: unknown, opts?: unknown) => Promise<unknown> };
  const result = await toolObj.execute(input, {
    experimental_context: appId ? { metadata: { appId } } : { metadata: {} }
  });
  return result as string;
}

function makeMatch(path: string, line: number, text: string, opts?: {
  contextBefore?: { line: number; text: string }[]
  contextAfter?: { line: number; text: string }[]
}) {
  return {
    path, line, column: 1, text,
    matchStart: 0, matchEnd: text.length,
    contextBefore: opts?.contextBefore ?? [],
    contextAfter: opts?.contextAfter ?? [],
  };
}

describe('grepSearchAITool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSupervisor.mockReturnValue({ exec: vi.fn() });
  });

  describe('Schema', () => {
    it('should accept Claude Code param names', () => {
      const result = grepSearchSchema.safeParse({
        pattern: 'test', path: 'src/', glob: '*.ts', type: 'ts',
        output_mode: 'content', '-i': true, '-n': true, '-A': 3, '-B': 2,
        '-C': 5, context: 4, head_limit: 10, offset: 5, multiline: true
      });
      expect(result.success).toBe(true);
    });

    it('should default output_mode to files_with_matches', () => {
      expect(grepSearchSchema.parse({ pattern: 'test' }).output_mode).toBe('files_with_matches');
    });

    it('should default head_limit to 0', () => {
      expect(grepSearchSchema.parse({ pattern: 'test' }).head_limit).toBe(0);
    });

    it('should default offset to 0', () => {
      expect(grepSearchSchema.parse({ pattern: 'test' }).offset).toBe(0);
    });

    it('should default multiline to false', () => {
      expect(grepSearchSchema.parse({ pattern: 'test' }).multiline).toBe(false);
    });

    it('should reject invalid output_mode', () => {
      expect(grepSearchSchema.safeParse({ pattern: 'test', output_mode: 'invalid' }).success).toBe(false);
    });
  });

  describe('Execution', () => {
    it('should throw when appId is missing', async () => {
      await expect(executeTool({ pattern: 'test' }))
        .rejects.toThrow('App ID is required');
    });

    it('should throw when app not found', async () => {
      mockFindById.mockReturnValue(null);
      await expect(executeTool({ pattern: 'test' }, 'nonexistent'))
        .rejects.toThrow("App 'nonexistent' not found");
    });

    it('should throw when supervisor not available', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockCreateSupervisor.mockReturnValue(null);
      await expect(executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      )).rejects.toThrow('Dev-supervisor not available');
    });

    it('should throw when ripgrep returns error', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [], totalMatches: 0, truncated: false, error: 'Search failed'
      });
      await expect(executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      )).rejects.toThrow('Grep search failed');
    });

    it('should return files_with_matches format', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [makeMatch('src/a.ts', 1, 'test'), makeMatch('src/b.ts', 5, 'test'), makeMatch('src/a.ts', 10, 'test again')],
        totalMatches: 3, truncated: false
      });
      const result = await executeTool(
        { pattern: 'test', output_mode: 'files_with_matches', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toBe('src/a.ts\nsrc/b.ts');
    });

    it('should return count format', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [makeMatch('src/a.ts', 1, 'test'), makeMatch('src/a.ts', 10, 'test again'), makeMatch('src/b.ts', 5, 'test')],
        totalMatches: 3, truncated: false
      });
      const result = await executeTool(
        { pattern: 'test', output_mode: 'count', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toBe('src/a.ts:2\nsrc/b.ts:1');
    });

    it('should return content format with line numbers', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [makeMatch('src/a.ts', 42, 'const test = true')],
        totalMatches: 1, truncated: false
      });
      const result = await executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toContain('src/a.ts');
      expect(result).toContain('42:const test = true');
    });

    it('should render context lines in content mode', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [
          makeMatch('src/a.ts', 10, 'const x = match', {
            contextBefore: [{ line: 8, text: '// before 1' }, { line: 9, text: '// before 2' }],
            contextAfter: [{ line: 11, text: '// after 1' }]
          })
        ],
        totalMatches: 1, truncated: false
      });
      const result = await executeTool(
        { pattern: 'match', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toContain('8-// before 1');
      expect(result).toContain('9-// before 2');
      expect(result).toContain('10:const x = match');
      expect(result).toContain('11-// after 1');
    });

    it('should not render context lines in files_with_matches mode', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [
          makeMatch('src/a.ts', 10, 'match', {
            contextBefore: [{ line: 9, text: 'context' }],
            contextAfter: [{ line: 11, text: 'context' }]
          })
        ],
        totalMatches: 1, truncated: false
      });
      const result = await executeTool(
        { pattern: 'match', output_mode: 'files_with_matches', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toBe('src/a.ts');
      expect(result).not.toContain('context');
    });

    it('should apply head_limit to files_with_matches', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({
        matches: [makeMatch('a.ts', 1, 'x'), makeMatch('b.ts', 1, 'x'), makeMatch('c.ts', 1, 'x')],
        totalMatches: 3, truncated: false
      });
      const result = await executeTool(
        { pattern: 'x', output_mode: 'files_with_matches', head_limit: 2, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toBe('a.ts\nb.ts');
    });

    it('should throw for path outside project', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      await expect(executeTool(
        { pattern: 'test', path: '../../etc/passwd', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      )).rejects.toThrow('outside the project directory');
    });

    it('should return no matches message when empty', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({ matches: [], totalMatches: 0, truncated: false });
      const result = await executeTool(
        { pattern: 'nonexistent', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true },
        'test-app'
      );
      expect(result).toBe('No matches found.');
    });

    it('should forward -C as contextLines', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({ matches: [], totalMatches: 0, truncated: false });
      await executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true, '-C': 5 },
        'test-app'
      );
      expect(mockRipgrepSearch).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'test',
        expect.objectContaining({ contextLines: 5 }),
        expect.anything()
      );
    });

    it('should forward context alias as contextLines', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({ matches: [], totalMatches: 0, truncated: false });
      await executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true, context: 3 },
        'test-app'
      );
      expect(mockRipgrepSearch).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'test',
        expect.objectContaining({ contextLines: 3 }),
        expect.anything()
      );
    });

    it('should forward -A and -B as afterContext and beforeContext', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({ matches: [], totalMatches: 0, truncated: false });
      await executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 0, offset: 0, multiline: false, '-n': true, '-A': 3, '-B': 2 },
        'test-app'
      );
      expect(mockRipgrepSearch).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'test',
        expect.objectContaining({ afterContext: 3, beforeContext: 2 }),
        expect.anything()
      );
    });

    it('should pass head_limit as maxResults (not head_limit + offset)', async () => {
      mockFindById.mockReturnValue({ path: '/tmp/app' });
      mockRipgrepSearch.mockResolvedValue({ matches: [], totalMatches: 0, truncated: false });
      await executeTool(
        { pattern: 'test', output_mode: 'content', head_limit: 10, offset: 5, multiline: false, '-n': true },
        'test-app'
      );
      expect(mockRipgrepSearch).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'test',
        expect.objectContaining({ maxResults: 10, offset: 5 }),
        expect.anything()
      );
    });
  });
});
