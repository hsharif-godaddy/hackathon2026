import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpFiles } from '../http-files.js';

function makeClient() {
  return { post: vi.fn() } as unknown as DevSupervisorClient;
}

describe('HttpFiles', () => {
  let client: DevSupervisorClient;
  let files: HttpFiles;

  beforeEach(() => {
    client = makeClient();
    files = new HttpFiles(client);
  });

  describe('tree()', () => {
    it('calls /workspace/files/tree with options', async () => {
      const mockResponse = {
        entries: [{ path: 'src', kind: 'directory', size: 0, modifiedAt: '2026-05-14T00:00:00Z' }],
        truncated: false,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await files.tree({ path: 'src', recursive: true, maxDepth: 3 });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/tree', {
        path: 'src',
        recursive: true,
        maxDepth: 3,
      });
      expect(result).toEqual(mockResponse);
    });

    it('sends empty object when no options provided', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [], truncated: false });
      await files.tree();
      expect(client.post).toHaveBeenCalledWith('/workspace/files/tree', {});
    });
  });

  describe('view()', () => {
    it('calls /workspace/files/view with path and line range', async () => {
      const mockResponse = {
        path: 'index.ts',
        content: 'const x = 1;',
        encoding: 'utf-8' as const,
        lines: 100,
        truncated: false,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await files.view({ path: 'index.ts', offset: 10, limit: 50 });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/view', {
        path: 'index.ts',
        offset: 10,
        limit: 50,
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('search()', () => {
    it('calls /workspace/files/search and returns matches array', async () => {
      const mockResponse = {
        matches: [{ path: 'src/app.ts', line: 5, column: 1, preview: 'const app = express()' }],
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await files.search({ pattern: 'express', caseSensitive: true });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/search', {
        pattern: 'express',
        caseSensitive: true,
      });
      expect(result).toEqual(mockResponse.matches);
    });
  });

  describe('write()', () => {
    it('calls /workspace/files/write with path and content', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 42 });

      const result = await files.write({ path: 'new-file.ts', content: 'export const x = 1;\n' });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/write', {
        path: 'new-file.ts',
        content: 'export const x = 1;\n',
      });
      expect(result.bytesWritten).toBe(42);
    });
  });

  describe('edit()', () => {
    it('calls /workspace/files/edit with find/replace', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ applied: 1 });

      const result = await files.edit({
        path: 'app.ts',
        oldString: 'const x = 1',
        newString: 'const x = 2',
      });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/edit', {
        path: 'app.ts',
        oldString: 'const x = 1',
        newString: 'const x = 2',
      });
      expect(result.applied).toBe(1);
    });

    it('passes replaceAll flag', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ applied: 3 });

      const result = await files.edit({
        path: 'app.ts',
        oldString: 'foo',
        newString: 'bar',
        replaceAll: true,
      });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/edit', {
        path: 'app.ts',
        oldString: 'foo',
        newString: 'bar',
        replaceAll: true,
      });
      expect(result.applied).toBe(3);
    });
  });

  describe('delete()', () => {
    it('calls /workspace/files/delete', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' });

      await files.delete({ path: 'tmp/old.ts' });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/delete', { path: 'tmp/old.ts' });
    });

    it('passes recursive flag', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' });

      await files.delete({ path: 'tmp', recursive: true });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/delete', {
        path: 'tmp',
        recursive: true,
      });
    });
  });

  describe('move()', () => {
    it('calls /workspace/files/move', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' });

      await files.move({ from: 'old.ts', to: 'new.ts' });

      expect(client.post).toHaveBeenCalledWith('/workspace/files/move', {
        from: 'old.ts',
        to: 'new.ts',
      });
    });
  });
});
