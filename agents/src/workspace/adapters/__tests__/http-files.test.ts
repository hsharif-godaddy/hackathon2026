import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpFiles } from '../http-files.js';

function makeClient() {
  return { post: vi.fn(), postStream: vi.fn(), getStream: vi.fn(), putStream: vi.fn() } as unknown as DevSupervisorClient;
}

function bufferStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
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
    it('parses headers and plain text body from postStream', async () => {
      (client.postStream as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: bufferStream(' 1|const x = 1;\n 2|const y = 2;'),
        headers: {
          'x-file-path': 'index.ts',
          'x-file-lines': '100',
          'x-file-size': '2048',
          'x-truncated': 'true',
        },
      });

      const result = await files.view({ path: 'index.ts', offset: 0, limit: 50 });

      expect(client.postStream).toHaveBeenCalledWith(
        '/workspace/files/view',
        { path: 'index.ts', offset: 0, limit: 50 },
        { Accept: '*/*' },
      );
      expect(result).toEqual({
        path: 'index.ts',
        content: ' 1|const x = 1;\n 2|const y = 2;',
        lines: 100,
        size: 2048,
        truncated: true,
      });
    });

    it('falls back to options.path when header missing', async () => {
      (client.postStream as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: bufferStream('1|hello'),
        headers: {},
      });

      const result = await files.view({ path: 'fallback.ts' });

      expect(result.path).toBe('fallback.ts');
      expect(result.lines).toBe(0);
      expect(result.size).toBe(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('readText()', () => {
    it('collects stream from getStream into UTF-8 string', async () => {
      (client.getStream as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: bufferStream('{"key": "value"}'),
        contentType: 'application/json',
        contentLength: 16,
        headers: {},
      });

      const result = await files.readText({ path: 'data.json' });

      expect(result).toBe('{"key": "value"}');
    });

    it('rejects files exceeding 10 MB', async () => {
      const oversized: Readable = bufferStream('x');
      (client.getStream as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: oversized,
        contentType: 'application/octet-stream',
        contentLength: 11 * 1024 * 1024,
        headers: {},
      });

      await expect(files.readText({ path: 'huge.bin' })).rejects.toThrow('File too large');
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

  describe('upload()', () => {
    it('uploads a Buffer via putStream with content length', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 5 });

      const result = await files.upload({ path: 'img/logo.png', data: Buffer.from('hello') });

      expect(client.putStream).toHaveBeenCalledWith(
        '/workspace/files/upload?path=img/logo.png',
        expect.any(Readable),
        5,
        undefined,
      );
      expect(result.bytesWritten).toBe(5);
    });

    it('uploads a Uint8Array via putStream with content length', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 3 });
      const data: Uint8Array = new Uint8Array([1, 2, 3]);

      const result = await files.upload({ path: 'bin/data.bin', data });

      expect(client.putStream).toHaveBeenCalledWith(
        '/workspace/files/upload?path=bin/data.bin',
        expect.any(Readable),
        3,
        undefined,
      );
      expect(result.bytesWritten).toBe(3);
    });

    it('uploads a string via putStream', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 11 });

      const result = await files.upload({ path: 'readme.txt', data: 'hello world' });

      expect(client.putStream).toHaveBeenCalledWith(
        '/workspace/files/upload?path=readme.txt',
        expect.any(Readable),
        11,
        undefined,
      );
      expect(result.bytesWritten).toBe(11);
    });

    it('uploads a Readable stream directly with streaming timeout', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 6 });
      const stream: Readable = Readable.from([Buffer.from('stream')]);

      const result = await files.upload({ path: 'data.bin', data: stream });

      expect(client.putStream).toHaveBeenCalledWith(
        '/workspace/files/upload?path=data.bin',
        stream,
        undefined,
        300_000,
      );
      expect(result.bytesWritten).toBe(6);
    });

    it('passes contentLength when provided with a Readable', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 1024 });
      const stream: Readable = Readable.from([Buffer.alloc(1024)]);

      const result = await files.upload({ path: 'big.bin', data: stream, contentLength: 1024 });

      expect(client.putStream).toHaveBeenCalledWith(
        '/workspace/files/upload?path=big.bin',
        stream,
        1024,
        300_000,
      );
      expect(result.bytesWritten).toBe(1024);
    });

    it('appends createOnly query param when set', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 4 });

      await files.upload({ path: 'new.txt', data: Buffer.from('test'), createOnly: true });

      const url: string = (client.putStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('createOnly=true');
    });

    it('appends root query param when set', async () => {
      (client.putStream as ReturnType<typeof vi.fn>).mockResolvedValue({ bytesWritten: 4 });

      await files.upload({ path: 'asset.png', data: Buffer.from('test'), root: 'public-assets' });

      const url: string = (client.putStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('root=public-assets');
    });
  });
});
