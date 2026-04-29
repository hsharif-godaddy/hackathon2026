import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isFileImmutable } from '../file-edit.js';
import type { FileHandle, FileSystemOperations } from '../../filesystem/index.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `immutable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('isFileImmutable', () => {
  describe('marker detection', () => {
    it('returns true when first line contains TREAT AS IMMUTABLE', async () => {
      const dir = makeTmpDir();
      try {
        const p = join(dir, 'locked.txt');
        writeFileSync(p, '// TREAT AS IMMUTABLE\nbody\n');
        await expect(isFileImmutable(p)).resolves.toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns false for regular files', async () => {
      const dir = makeTmpDir();
      try {
        const p = join(dir, 'plain.txt');
        writeFileSync(p, 'just some text\n');
        await expect(isFileImmutable(p)).resolves.toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns false for non-existent files', async () => {
      await expect(isFileImmutable('/does/not/exist/xyz.txt')).resolves.toBe(false);
    });
  });

  describe('permission error surfacing', () => {
    it('propagates EACCES from fs.exists (does not swallow it to mutable)', async () => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const fs = {
        async exists(_: string): Promise<boolean> { throw err; },
      } as unknown as FileSystemOperations;
      await expect(isFileImmutable('/app/protected.ts', fs)).rejects.toThrow('EACCES');
    });

    it('propagates EACCES from fs.open', async () => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const fs = {
        async exists(_: string): Promise<boolean> { return true; },
        async open(_path: string, _flags: string): Promise<FileHandle> { throw err; },
      } as unknown as FileSystemOperations;
      await expect(isFileImmutable('/app/protected.ts', fs)).rejects.toThrow('EACCES');
    });

    it('closes the handle even when read() throws', async () => {
      let closed = false;
      const fs = {
        async exists(_: string): Promise<boolean> { return true; },
        async open(_path: string, _flags: string): Promise<FileHandle> {
          return {
            async read() { throw new Error('read boom'); },
            async close() { closed = true; },
          };
        },
      } as unknown as FileSystemOperations;
      await expect(isFileImmutable('/app/flaky.ts', fs)).rejects.toThrow('read boom');
      expect(closed).toBe(true);
    });
  });
});
