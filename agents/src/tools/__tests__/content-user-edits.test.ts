import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  USER_EDITS_FILE,
  readUserLocks,
  recordUserLock,
} from '../content-user-edits.js';

async function mkTempContentDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'airo-user-edits-'));
}

async function readLockFile(dir: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(dir, USER_EDITS_FILE), 'utf8'));
}

describe('readUserLocks', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns [] when the lock file is absent', async () => {
    expect(await readUserLocks(dir)).toEqual([]);
  });

  it('returns [] when the lock file is malformed JSON', async () => {
    await fs.writeFile(path.join(dir, USER_EDITS_FILE), '{ not json', 'utf8');
    expect(await readUserLocks(dir)).toEqual([]);
  });

  it('returns [] when the lock file has the wrong shape (no lockedKeys array)', async () => {
    await fs.writeFile(path.join(dir, USER_EDITS_FILE), JSON.stringify({ lockedKeys: 'nope' }), 'utf8');
    expect(await readUserLocks(dir)).toEqual([]);
  });

  it('returns [] when the top-level value is an array', async () => {
    await fs.writeFile(path.join(dir, USER_EDITS_FILE), JSON.stringify(['site.brand']), 'utf8');
    expect(await readUserLocks(dir)).toEqual([]);
  });

  it('filters out non-string entries', async () => {
    await fs.writeFile(
      path.join(dir, USER_EDITS_FILE),
      JSON.stringify({ lockedKeys: ['site.brand', 42, null, 'home.hero.title'] }),
      'utf8',
    );
    expect(await readUserLocks(dir)).toEqual(['site.brand', 'home.hero.title']);
  });

  it('rethrows a non-ENOENT read error (e.g. EACCES) so callers can fail safe', async () => {
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const spy = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(eacces);
    try {
      await expect(readUserLocks(dir)).rejects.toThrow(/permission denied/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('recordUserLock', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('creates the lock file with the recorded key on first call', async () => {
    expect(await recordUserLock(dir, 'site.brand')).toBe(true);
    expect(await readLockFile(dir)).toEqual({ lockedKeys: ['site.brand'] });
  });

  it('writes pretty JSON with a trailing newline', async () => {
    await recordUserLock(dir, 'site.brand');
    const raw = await fs.readFile(path.join(dir, USER_EDITS_FILE), 'utf8');
    expect(raw).toBe('{\n  "lockedKeys": [\n    "site.brand"\n  ]\n}\n');
  });

  it('adds a second key without duplicating, keeping the list sorted', async () => {
    await recordUserLock(dir, 'products[0].price');
    expect(await recordUserLock(dir, 'home.hero.title')).toBe(true);
    expect(await readUserLocks(dir)).toEqual(['home.hero.title', 'products[0].price']);
  });

  it('is idempotent — recording the same key twice does not duplicate it', async () => {
    await recordUserLock(dir, 'site.brand');
    expect(await recordUserLock(dir, 'site.brand')).toBe(true);
    expect(await readUserLocks(dir)).toEqual(['site.brand']);
  });

  it('returns false (and does not throw) when the content dir is invalid/unwritable', async () => {
    // Point at a path whose parent is a regular file → atomicWrite hits ENOTDIR.
    const filePath = path.join(dir, 'not-a-dir');
    await fs.writeFile(filePath, 'x', 'utf8');
    const bogusContentDir = path.join(filePath, 'content');
    await expect(recordUserLock(bogusContentDir, 'site.brand')).resolves.toBe(false);
  });

  it('returns false and logs without throwing when atomicWrite rejects', async () => {
    const fsUtils = await import('../../utils/fs-utils.js');
    const spy = vi.spyOn(fsUtils, 'atomicWrite').mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(recordUserLock(dir, 'site.brand')).resolves.toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
