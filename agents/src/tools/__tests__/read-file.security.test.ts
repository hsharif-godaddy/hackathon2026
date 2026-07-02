import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ReadFileTool, isFileBlocked } from '../read-file';
import { DevSupervisorError } from '../../services/DevSupervisorClient';
import type { WorkspaceFiles, ViewResult } from '../../workspace/files';

function createMockFiles(overrides?: Partial<WorkspaceFiles>): WorkspaceFiles {
  return {
    tree: vi.fn(),
    view: vi.fn(),
    readText: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    stat: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceFiles;
}

/** Simulate server-formatted view response (pre-numbered lines). */
function viewResult(content: string, lines?: number): ViewResult {
  const lineCount: number = lines ?? content.split('\n').length;
  return { path: 'test.txt', content, lines: lineCount, size: content.length, truncated: false };
}

describe('ReadFileTool', () => {
  let readFileTool: ReadFileTool;
  let mockFiles: WorkspaceFiles;

  beforeEach(() => {
    // view() now returns pre-numbered content from the server.
    mockFiles = createMockFiles({
      view: vi.fn().mockResolvedValue(viewResult('1|line1\n2|line2\n3|line3', 3)),
    });
    readFileTool = new ReadFileTool(mockFiles);
  });

  describe('isFileBlocked guardrails', () => {
    it('should block lock files before calling view', async () => {
      const result = await readFileTool.readFile({ path: 'package-lock.json' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Lock files');
      expect(mockFiles.view).not.toHaveBeenCalled();
    });

    it('should block node_modules paths', async () => {
      const result = await readFileTool.readFile({ path: 'node_modules/foo/index.js' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependency directory');
      expect(mockFiles.view).not.toHaveBeenCalled();
    });

    it('should block image files', async () => {
      const result = await readFileTool.readFile({ path: 'assets/logo.png' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot read image as text');
      expect(mockFiles.view).not.toHaveBeenCalled();
    });

    it('should allow normal source files', async () => {
      const result = await readFileTool.readFile({ path: 'src/app.tsx' });
      expect(result.success).toBe(true);
      expect(mockFiles.view).toHaveBeenCalledWith({ path: 'src/app.tsx', offset: 0, limit: undefined });
    });
  });

  describe('binary detection from server error', () => {
    it('should return friendly error when server rejects binary file', async () => {
      const binaryErr = new DevSupervisorError('binary_file', 422, 'file is binary');
      mockFiles = createMockFiles({
        view: vi.fn().mockRejectedValue(binaryErr),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'data.custom' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Binary file');
    });

    it('should return image-specific message for image extensions', async () => {
      const binaryErr = new DevSupervisorError('binary_file', 422, 'file is binary');
      mockFiles = createMockFiles({
        view: vi.fn().mockRejectedValue(binaryErr),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'photo.png' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot read image as text');
    });
  });



  describe('line range selection', () => {
    it('should pass offset and limit to view', async () => {
      await readFileTool.readFile({ path: 'file.ts', startLine: 5, numLines: 10 });
      expect(mockFiles.view).toHaveBeenCalledWith({ path: 'file.ts', offset: 4, limit: 10 });
    });

    it('should report linesRead when range requested', async () => {
      mockFiles = createMockFiles({
        view: vi.fn().mockResolvedValue(viewResult('line5\nline6', 10)),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'file.ts', startLine: 5, numLines: 2 });
      expect(result.success).toBe(true);
      expect(result.linesRead).toEqual({ start: 5, end: 6 });
      expect(result.totalLines).toBe(10);
    });

    it('should error when startLine exceeds file length', async () => {
      mockFiles = createMockFiles({
        view: vi.fn().mockResolvedValue(viewResult('', 3)),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'file.ts', startLine: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds file length');
    });
  });

  describe('truncation propagation', () => {
    it('should propagate truncated flag and include linesRead', async () => {
      mockFiles = createMockFiles({
        view: vi.fn().mockResolvedValue({
          path: 'big.ts', content: 'line1\nline2', encoding: 'utf-8', lines: 5000, size: 50000, truncated: true,
        }),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'big.ts' });
      expect(result.success).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.totalLines).toBe(5000);
      expect(result.linesRead).toEqual({ start: 1, end: 2 });
    });

    it('should not set truncated when response is complete', async () => {
      const result = await readFileTool.readFile({ path: 'small.ts' });
      expect(result.success).toBe(true);
      expect(result.truncated).toBeUndefined();
    });
  });

  describe('Docker path translation', () => {
    it('should strip /app/ prefix', async () => {
      await readFileTool.readFile({ path: '/app/src/index.ts' });
      expect(mockFiles.view).toHaveBeenCalledWith({ path: 'src/index.ts', offset: 0, limit: undefined });
    });
  });

  describe('error propagation', () => {
    it('should wrap workspace errors', async () => {
      mockFiles = createMockFiles({
        view: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: 'missing.ts' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('ENOENT: no such file');
    });

    it('should surface path-traversal rejections from supervisor', async () => {
      mockFiles = createMockFiles({
        view: vi.fn().mockRejectedValue(new Error('path escapes workspace root')),
      });
      readFileTool = new ReadFileTool(mockFiles);

      const result = await readFileTool.readFile({ path: '../../etc/passwd' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('path escapes workspace root');
    });
  });
});

describe('isFileBlocked', () => {
  describe('Binary file blocking', () => {
    it('should block image files with image-specific reason', () => {
      const result = isFileBlocked('assets/logo.png');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read image as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should block jpg with image-specific reason', () => {
      const result = isFileBlocked('photo.jpg');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read image as text');
    });

    it('should block PDF with document-specific reason', () => {
      const result = isFileBlocked('report.pdf');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read PDF as text');
      expect(result.reason).toContain('paste relevant content');
    });

    it('should block DOCX with document-specific reason', () => {
      const result = isFileBlocked('spec.docx');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read DOCX as text');
    });

    it('should block archive files with generic binary reason', () => {
      const result = isFileBlocked('bundle.zip');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('not readable as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should block executable files', () => {
      const result = isFileBlocked('app.exe');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('not readable as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should not block SVG files', () => {
      const result = isFileBlocked('icon.svg');
      expect(result.blocked).toBe(false);
    });

    it('should not block source code files', () => {
      expect(isFileBlocked('app.tsx').blocked).toBe(false);
      expect(isFileBlocked('index.js').blocked).toBe(false);
      expect(isFileBlocked('styles.css').blocked).toBe(false);
    });
  });

  describe('Lock files', () => {
    it('should block package-lock.json', () => {
      expect(isFileBlocked('package-lock.json').blocked).toBe(true);
    });

    it('should block pnpm-lock.yaml', () => {
      expect(isFileBlocked('pnpm-lock.yaml').blocked).toBe(true);
    });
  });

  describe('Dependency directories', () => {
    it('should block node_modules', () => {
      expect(isFileBlocked('node_modules/react/index.js').blocked).toBe(true);
    });

    it('should block vendor', () => {
      expect(isFileBlocked('vendor/autoload.php').blocked).toBe(true);
    });
  });

  describe('Cache directories', () => {
    it('should block .cache', () => {
      expect(isFileBlocked('.cache/build.json').blocked).toBe(true);
    });

    it('should block .vite', () => {
      expect(isFileBlocked('.vite/deps/react.js').blocked).toBe(true);
    });
  });

  describe('Log files', () => {
    it('should block .log files', () => {
      expect(isFileBlocked('error.log').blocked).toBe(true);
    });

    it('should block npm-debug', () => {
      expect(isFileBlocked('npm-debug.log.0').blocked).toBe(true);
    });
  });

  describe('Protected .airo directory', () => {
    it('should block files at the .airo root', () => {
      const result = isFileBlocked('.airo/config.json');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('.airo');
    });

    it('should block nested .airo paths', () => {
      expect(isFileBlocked('apps/foo/.airo/state.json').blocked).toBe(true);
    });

    it('should block case-variant .AIRO', () => {
      expect(isFileBlocked('.AIRO/config.json').blocked).toBe(true);
    });

    it('should not block lookalike names that merely contain "airo"', () => {
      expect(isFileBlocked('src/airoutes.ts').blocked).toBe(false);
      expect(isFileBlocked('cairo-renderer.ts').blocked).toBe(false);
    });
  });
});
