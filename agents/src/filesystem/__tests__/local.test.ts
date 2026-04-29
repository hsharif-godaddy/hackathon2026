import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFileSystemOperations } from '../local.js';

describe('LocalFileSystemOperations', () => {
  let testDir: string;
  let fs: LocalFileSystemOperations;

  beforeEach(() => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testDir = join(tmpdir(), `test-local-fs-${uniqueId}`);
    mkdirSync(testDir, { recursive: true });
    fs = new LocalFileSystemOperations();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('exists', () => {
    it('returns false when file does not exist (does not throw ENOENT)', async () => {
      await expect(fs.exists(join(testDir, 'nope.txt'))).resolves.toBe(false);
    });

    it('returns true when file exists', async () => {
      const p = join(testDir, 'present.txt');
      writeFileSync(p, 'x');
      await expect(fs.exists(p)).resolves.toBe(true);
    });

    it('returns true for a directory', async () => {
      await expect(fs.exists(testDir)).resolves.toBe(true);
    });

    // chmod has no effect when running as root (common on Docker CI), so skip visibly
    it.skipIf(process.getuid?.() === 0)('surfaces EACCES rather than masking it as non-existence', async () => {
      const sub = join(testDir, 'locked');
      mkdirSync(sub);
      const target = join(sub, 'inside.txt');
      writeFileSync(target, 'data');
      chmodSync(sub, 0o000);
      try {
        await expect(fs.exists(target)).rejects.toThrow();
      } finally {
        chmodSync(sub, 0o700);
      }
    });
  });

  describe('readFile overloads', () => {
    it('returns string when encoding is provided', async () => {
      const p = join(testDir, 'a.txt');
      writeFileSync(p, 'hello');
      const result = await fs.readFile(p, 'utf-8');
      expect(result).toBe('hello');
      expect(typeof result).toBe('string');
    });

    it('returns Buffer when encoding is omitted', async () => {
      const p = join(testDir, 'b.bin');
      writeFileSync(p, Buffer.from([0x01, 0x02, 0x03]));
      const result = await fs.readFile(p);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    });
  });

  describe('open + read', () => {
    it('reads first bytes via FileHandle and closes cleanly', async () => {
      const p = join(testDir, 'c.txt');
      writeFileSync(p, 'abcdef');
      const handle = await fs.open(p, 'r');
      try {
        const buf = Buffer.alloc(3);
        const { bytesRead } = await handle.read(buf, 0, 3, 0);
        expect(bytesRead).toBe(3);
        expect(buf.toString('utf-8', 0, bytesRead)).toBe('abc');
      } finally {
        await handle.close();
      }
    });
  });

  describe('createWriteStream', () => {
    it('writes to file via stream', async () => {
      const p = join(testDir, 'stream.txt');
      const ws = fs.createWriteStream(p);
      ws.write('streamed');
      ws.end();
      await new Promise<void>((resolve, reject) => {
        ws.on('finish', () => resolve());
        ws.on('error', reject);
      });
      expect(readFileSync(p, 'utf-8')).toBe('streamed');
    });
  });
});
