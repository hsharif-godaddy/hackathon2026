import { describe, it, expect } from 'vitest';
import { RipgrepUtil } from '../ripgrep-util';

describe('RipgrepUtil', () => {
  describe('buildCommand', () => {
    it('should build basic command with relative directory', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', {});
      expect(cmd).toContain('rg --json');
      expect(cmd).toContain('--ignore-case');
      expect(cmd).toContain('--fixed-strings');
      expect(cmd).toContain("'.'");
    });

    it('should use regex mode when specified', () => {
      const cmd = RipgrepUtil.buildCommand('foo.*bar', '.', { regex: true });
      expect(cmd).not.toContain('--fixed-strings');
    });

    it('should respect case sensitivity', () => {
      const cmd = RipgrepUtil.buildCommand('Test', '.', { caseSensitive: true });
      expect(cmd).not.toContain('--ignore-case');
    });

    it('should add --context for symmetric context', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { contextLines: 5 });
      expect(cmd).toContain('--context 5');
    });

    it('should add --glob for file pattern', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { filePattern: '*.ts' });
      expect(cmd).toContain("--glob '*.ts'");
    });

    it('should add --word-regexp for wholeWord', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { wholeWord: true });
      expect(cmd).toContain('--word-regexp');
    });

    it('should add --type for fileType', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { fileType: 'ts' });
      expect(cmd).toContain("--type 'ts'");
    });

    it('should escape fileType with shell metacharacters', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { fileType: 'ts; rm -rf /' });
      expect(cmd).toContain("--type 'ts; rm -rf /'");
      expect(cmd).not.toContain('--type ts;');
    });

    it('should add --multiline --multiline-dotall for multiline', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { multiline: true });
      expect(cmd).toContain('--multiline');
      expect(cmd).toContain('--multiline-dotall');
    });

    it('should add -A for afterContext', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { afterContext: 3 });
      expect(cmd).toContain('-A 3');
      expect(cmd).not.toContain('--context');
    });

    it('should add -B for beforeContext', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', { beforeContext: 2 });
      expect(cmd).toContain('-B 2');
      expect(cmd).not.toContain('--context');
    });

    it('should use -A/-B instead of -C when both are set', () => {
      const cmd = RipgrepUtil.buildCommand('test', '.', {
        afterContext: 3, beforeContext: 2, contextLines: 5
      });
      expect(cmd).toContain('-A 3');
      expect(cmd).toContain('-B 2');
      expect(cmd).not.toContain('--context');
    });

    it('should escape query with single quotes', () => {
      const cmd = RipgrepUtil.buildCommand("it's a test", '.', {});
      expect(cmd).toContain("'it'\\''s a test'");
    });

    it('should accept a subdirectory as search target', () => {
      const cmd = RipgrepUtil.buildCommand('test', 'src/pages', {});
      expect(cmd).toContain("'src/pages'");
    });

    it('should accept a single file as search target', () => {
      const cmd = RipgrepUtil.buildCommand('test', 'src/pages/index.tsx', {});
      expect(cmd).toContain("'src/pages/index.tsx'");
    });
  });

  describe('parseOutput', () => {
    // Ripgrep outputs paths relative to its search directory.
    // When searching '.', paths are prefixed with './' (e.g. './src/a.ts').
    // When searching a subdirectory, paths use that prefix (e.g. 'src/pages/index.tsx').

    function makeMatchLine(filePath: string, lineNumber: number, text: string, start: number, end: number): string {
      return JSON.stringify({
        type: 'match',
        data: {
          path: { text: filePath },
          line_number: lineNumber,
          lines: { text: text + '\n' },
          submatches: [{ start, end }]
        }
      });
    }

    function makeContextLine(filePath: string, lineNumber: number, text: string): string {
      return JSON.stringify({
        type: 'context',
        data: {
          path: { text: filePath },
          line_number: lineNumber,
          lines: { text: text + '\n' }
        }
      });
    }

    it('should parse matches with ./ prefix when searching project root', () => {
      const stdout = makeMatchLine('./src/a.ts', 10, 'const x = test', 10, 14);
      const result = RipgrepUtil.parseOutput(stdout, '.', 'test', 100);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].path).toBe('src/a.ts');
      expect(result.matches[0].line).toBe(10);
      expect(result.matches[0].text).toBe('const x = test');
      expect(result.matches[0].contextBefore).toEqual([]);
      expect(result.matches[0].contextAfter).toEqual([]);
    });

    it('should preserve full path for subdirectory search', () => {
      const stdout = makeMatchLine('src/pages/index.tsx', 5, 'Shop Now', 0, 8);
      const result = RipgrepUtil.parseOutput(stdout, 'src/pages', 'Shop Now', 100);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].path).toBe('src/pages/index.tsx');
    });

    it('should parse matches for single-file search', () => {
      const stdout = makeMatchLine('src/pages/index.tsx', 5, 'Shop Now', 0, 8);
      const result = RipgrepUtil.parseOutput(stdout, 'src/pages/index.tsx', 'Shop Now', 100);
      expect(result.matches).toHaveLength(1);
      // path.relative('src/pages/index.tsx', 'src/pages/index.tsx') = ''
      // toRelativePath falls back to the original path
      expect(result.matches[0].path).toBe('src/pages/index.tsx');
    });

    it('should collect context lines before a match', () => {
      const lines = [
        makeContextLine('./a.ts', 8, 'before 1'),
        makeContextLine('./a.ts', 9, 'before 2'),
        makeMatchLine('./a.ts', 10, 'the match', 0, 5),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].contextBefore).toEqual([
        { line: 8, text: 'before 1' },
        { line: 9, text: 'before 2' },
      ]);
    });

    it('should collect context lines after a match', () => {
      const lines = [
        makeMatchLine('./a.ts', 10, 'the match', 0, 5),
        makeContextLine('./a.ts', 11, 'after 1'),
        makeContextLine('./a.ts', 12, 'after 2'),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].contextAfter).toEqual([
        { line: 11, text: 'after 1' },
        { line: 12, text: 'after 2' },
      ]);
    });

    it('should split context between adjacent matches', () => {
      const lines = [
        makeContextLine('./a.ts', 8, 'before first'),
        makeMatchLine('./a.ts', 10, 'first match', 0, 5),
        makeContextLine('./a.ts', 11, 'between'),
        makeContextLine('./a.ts', 12, 'before second'),
        makeMatchLine('./a.ts', 14, 'second match', 0, 6),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].contextBefore).toEqual([{ line: 8, text: 'before first' }]);
      expect(result.matches[0].contextAfter).toEqual([{ line: 11, text: 'between' }]);
      expect(result.matches[1].contextBefore).toEqual([{ line: 12, text: 'before second' }]);
    });

    it('should respect maxResults', () => {
      const lines = [
        makeMatchLine('./a.ts', 1, 'line1', 0, 4),
        makeMatchLine('./b.ts', 2, 'line2', 0, 4),
        makeMatchLine('./c.ts', 3, 'line3', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 2);
      expect(result.matches).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('should skip matches with offset', () => {
      const lines = [
        makeMatchLine('./a.ts', 1, 'line1', 0, 4),
        makeMatchLine('./b.ts', 2, 'line2', 0, 4),
        makeMatchLine('./c.ts', 3, 'line3', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100, undefined, 1);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].path).toBe('b.ts');
    });

    it('should clear pending context when skipping offset matches', () => {
      const lines = [
        makeContextLine('./a.ts', 1, 'ctx for skipped'),
        makeMatchLine('./a.ts', 2, 'skipped', 0, 4),
        makeContextLine('./b.ts', 5, 'ctx for kept'),
        makeMatchLine('./b.ts', 6, 'kept', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100, undefined, 1);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].contextBefore).toEqual([{ line: 5, text: 'ctx for kept' }]);
    });

    it('should filter blocked files', () => {
      const lines = [
        makeMatchLine('./allowed.ts', 1, 'test', 0, 4),
        makeMatchLine('./blocked.ts', 2, 'test', 0, 4),
      ];
      const blocker = (p: string) => !p.includes('blocked');
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100, blocker);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].path).toBe('allowed.ts');
    });

    it('should handle empty output', () => {
      const result = RipgrepUtil.parseOutput('', '.', 'test', 100);
      expect(result.matches).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });

    it('should skip non-match JSON lines', () => {
      const lines = [
        JSON.stringify({ type: 'begin', data: {} }),
        makeMatchLine('./a.ts', 1, 'test', 0, 4),
        JSON.stringify({ type: 'end', data: {} }),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100);
      expect(result.matches).toHaveLength(1);
    });

    it('should handle offset with maxResults', () => {
      const lines = [
        makeMatchLine('./a.ts', 1, 'line1', 0, 4),
        makeMatchLine('./b.ts', 2, 'line2', 0, 4),
        makeMatchLine('./c.ts', 3, 'line3', 0, 4),
        makeMatchLine('./d.ts', 4, 'line4', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 2, undefined, 1);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].path).toBe('b.ts');
      expect(result.matches[1].path).toBe('c.ts');
    });

    it('should not report truncated when result count exactly equals maxResults with no remaining data', () => {
      const lines = [
        makeMatchLine('./a.ts', 1, 'line1', 0, 4),
        makeMatchLine('./b.ts', 2, 'line2', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 2);
      expect(result.matches).toHaveLength(2);
      expect(result.truncated).toBe(false);
    });

    it('should report truncated when there are more matches beyond maxResults', () => {
      const lines = [
        makeMatchLine('./a.ts', 1, 'line1', 0, 4),
        makeMatchLine('./b.ts', 2, 'line2', 0, 4),
        makeMatchLine('./c.ts', 3, 'line3', 0, 4),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 2);
      expect(result.matches).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('should split equidistant context lines to the later match', () => {
      const lines = [
        makeMatchLine('./a.ts', 10, 'first', 0, 5),
        makeContextLine('./a.ts', 12, 'equidistant'),
        makeMatchLine('./a.ts', 14, 'second', 0, 6),
      ];
      const result = RipgrepUtil.parseOutput(lines.join('\n'), '.', 'test', 100);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].contextAfter).toEqual([]);
      expect(result.matches[1].contextBefore).toEqual([{ line: 12, text: 'equidistant' }]);
    });
  });
});
