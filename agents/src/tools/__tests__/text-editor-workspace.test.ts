import { describe, it, expect, vi } from 'vitest';
import type { WorkspaceFiles, ViewResult, TreeResult } from '../../workspace/files.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import { handleView, handleStrReplace, handleCreate, handleInsert } from '../text-editor-workspace.js';

function createMockFiles(overrides?: Partial<WorkspaceFiles>): WorkspaceFiles {
  return {
    tree: vi.fn(),
    view: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceFiles;
}

describe('text-editor-workspace', () => {
  describe('handleView', () => {
    it('formats content with line numbers', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'src/index.ts',
        content: 'line one\nline two\nline three',
        encoding: 'utf-8',
        lines: 3,
        size: 28,
        truncated: false,
      });
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'src/index.ts');

      expect(result).toBe('1: line one\n2: line two\n3: line three');
      expect(mockView).toHaveBeenCalledWith({ path: 'src/index.ts' });
    });

    it('passes offset and limit for view_range', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'src/index.ts',
        content: 'line five\nline six\nline seven',
        encoding: 'utf-8',
        lines: 3,
        size: 29,
        truncated: false,
      });
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'src/index.ts', [5, 7]);

      expect(result).toBe('5: line five\n6: line six\n7: line seven');
      expect(mockView).toHaveBeenCalledWith({ path: 'src/index.ts', offset: 4, limit: 3 });
    });

    it('passes no limit when view_range end is -1', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'src/index.ts',
        content: 'line ten\nline eleven',
        encoding: 'utf-8',
        lines: 2,
        size: 20,
        truncated: false,
      });
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'src/index.ts', [10, -1]);

      expect(result).toBe('10: line ten\n11: line eleven');
      expect(mockView).toHaveBeenCalledWith({ path: 'src/index.ts', offset: 9 });
    });

    it('detects binary via base64 encoding in response', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'image.dat',
        content: 'AAAA',
        encoding: 'base64',
        lines: 0,
        size: 3,
        truncated: false,
      });
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'image.dat');

      expect(result).toContain('binary file');
    });

    it('detects binary by extension before calling API', async () => {
      const mockView = vi.fn();
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'logo.png');

      expect(result).toContain('Cannot read logo.png');
      expect(result).toContain('image file');
      expect(mockView).not.toHaveBeenCalled();
    });

    it('detects document extensions before calling API', async () => {
      const mockView = vi.fn();
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'report.pdf');

      expect(result).toContain('Cannot read report.pdf');
      expect(result).toContain('PDF');
      expect(mockView).not.toHaveBeenCalled();
    });

    it('detects other binary extensions before calling API', async () => {
      const mockView = vi.fn();
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'data.zip');

      expect(result).toContain('Cannot read data.zip');
      expect(result).toContain('binary file');
      expect(mockView).not.toHaveBeenCalled();
    });

    it('falls back to tree listing on EISDIR error', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockRejectedValue(
        new DevSupervisorError('is_directory', 400, 'src is a directory'),
      );
      const mockTree = vi.fn<() => Promise<TreeResult>>().mockResolvedValue({
        entries: [
          { path: 'src/index.ts', kind: 'file', size: 100, modifiedAt: '2026-01-01T00:00:00Z' },
          { path: 'src/utils', kind: 'directory', size: 0, modifiedAt: '2026-01-01T00:00:00Z' },
        ],
        truncated: false,
      });
      const files = createMockFiles({ view: mockView, tree: mockTree });

      const result = await handleView(files, 'src');

      expect(result).toContain('index.ts');
      expect(result).toContain('utils/');
      expect(mockTree).toHaveBeenCalledWith({ path: 'src', recursive: false });
    });

    it('allows SVG files to be viewed', async () => {
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'icon.svg',
        content: '<svg></svg>',
        encoding: 'utf-8',
        lines: 1,
        size: 11,
        truncated: false,
      });
      const files = createMockFiles({ view: mockView });

      const result = await handleView(files, 'icon.svg');

      expect(result).toBe('1: <svg></svg>');
      expect(mockView).toHaveBeenCalled();
    });
  });

  describe('handleStrReplace', () => {
    it('returns success message on successful edit', async () => {
      const mockEdit = vi.fn().mockResolvedValue({ applied: 1 });
      const files = createMockFiles({ edit: mockEdit });

      const result = await handleStrReplace(files, 'src/index.ts', 'old text', 'new text');

      expect(result).toBe('Successfully replaced text.');
      expect(mockEdit).toHaveBeenCalledWith({
        path: 'src/index.ts',
        oldString: 'old text',
        newString: 'new text',
      });
    });

    it('throws enriched error on no_match', async () => {
      const mockEdit = vi.fn().mockRejectedValue(new DevSupervisorError('no_match', 400, 'oldString not found in file'));
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'src/index.ts',
        content: 'actual content\nof the file',
        encoding: 'utf-8',
        lines: 2,
        size: 27,
        truncated: false,
      });
      const files = createMockFiles({ edit: mockEdit, view: mockView });

      await expect(handleStrReplace(files, 'src/index.ts', 'missing text', 'new text'))
        .rejects.toThrow('No match found for old_str');

      expect(mockView).toHaveBeenCalledWith({ path: 'src/index.ts' });
    });

    it('throws enriched error on ambiguous_match', async () => {
      const mockEdit = vi.fn().mockRejectedValue(
        new DevSupervisorError('ambiguous_match', 400, 'oldString found 3 times'),
      );
      const mockView = vi.fn<() => Promise<ViewResult>>().mockResolvedValue({
        path: 'src/index.ts',
        content: 'foo\nfoo\nfoo\nbar',
        encoding: 'utf-8',
        lines: 4,
        size: 15,
        truncated: false,
      });
      const files = createMockFiles({ edit: mockEdit, view: mockView });

      await expect(handleStrReplace(files, 'src/index.ts', 'foo', 'baz'))
        .rejects.toThrow(/Found \d+ matches/);

      expect(mockView).toHaveBeenCalledWith({ path: 'src/index.ts' });
    });

    it('rethrows unexpected errors without enrichment', async () => {
      const mockEdit = vi.fn().mockRejectedValue(new Error('HTTP 500: internal server error'));
      const files = createMockFiles({ edit: mockEdit });

      await expect(handleStrReplace(files, 'src/index.ts', 'old', 'new'))
        .rejects.toThrow('HTTP 500: internal server error');
    });
  });

  describe('handleCreate', () => {
    it('writes file and returns success message', async () => {
      const mockWrite = vi.fn().mockResolvedValue({ bytesWritten: 13 });
      const files = createMockFiles({ write: mockWrite });

      const result = await handleCreate(files, 'src/new-file.ts', 'file content');

      expect(result).toBe('Successfully created new-file.ts');
      expect(mockWrite).toHaveBeenCalledWith({ path: 'src/new-file.ts', content: 'file content' });
    });
  });

  describe('handleInsert', () => {
    it('inserts text and returns success message', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ lines: 3 });
      const files = createMockFiles({ insert: mockInsert });

      const result = await handleInsert(files, 'src/index.ts', 5, 'inserted line');

      expect(result).toBe('Successfully inserted text at line 5');
      expect(mockInsert).toHaveBeenCalledWith({
        path: 'src/index.ts',
        line: 6,
        content: 'inserted line',
      });
    });
  });
});
