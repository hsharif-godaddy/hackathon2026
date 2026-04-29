import { describe, it, expect } from 'vitest';
import { isBinaryFile } from '../file-types.js';
import type { FileHandle, FileSystemOperations } from '../../filesystem/index.js';

function mockFsWithOpen(firstBytes: Buffer, openError?: NodeJS.ErrnoException) {
  const openCalls: Array<[string, string]> = [];
  const handle: FileHandle = {
    async read(buffer, offset, length, _position) {
      firstBytes.copy(buffer, offset, 0, Math.min(length, firstBytes.length));
      return { bytesRead: Math.min(length, firstBytes.length) };
    },
    async close() {},
  };
  const fs = {
    async open(path: string, flags: string): Promise<FileHandle> {
      openCalls.push([path, flags]);
      if (openError) throw openError;
      return handle;
    },
  } as unknown as FileSystemOperations;
  return { fs, openCalls };
}

describe('isBinaryFile', () => {
  it('routes through the injected FileSystemOperations', async () => {
    const { fs, openCalls } = mockFsWithOpen(Buffer.from([0x48, 0x00, 0x49]));
    await expect(isBinaryFile('/app/some.bin', fs)).resolves.toBe(true);
    expect(openCalls).toEqual([['/app/some.bin', 'r']]);
  });

  it('returns false when no null byte is found', async () => {
    const { fs } = mockFsWithOpen(Buffer.from('hello world', 'utf-8'));
    await expect(isBinaryFile('/app/readme.txt', fs)).resolves.toBe(false);
  });

  it('returns false when the file does not exist (ENOENT)', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const { fs } = mockFsWithOpen(Buffer.alloc(0), err);
    await expect(isBinaryFile('/app/missing', fs)).resolves.toBe(false);
  });

  it('propagates non-ENOENT errors (e.g. EACCES)', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const { fs } = mockFsWithOpen(Buffer.alloc(0), err);
    await expect(isBinaryFile('/app/protected', fs)).rejects.toThrow('EACCES');
  });

  it('uses defaultLocalFs when no fs is passed (default parameter is wired)', async () => {
    // A non-existent path hits the default LocalFileSystemOperations, which
    // throws ENOENT; the catch narrows to false.
    await expect(isBinaryFile('/nonexistent/path/zzz.bin')).resolves.toBe(false);
  });
});
