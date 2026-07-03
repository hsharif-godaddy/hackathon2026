import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStore } from '../local-file-store.js';

describe('LocalFileStore', () => {
  let dir: string;
  let store: LocalFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'local-file-store-'));
    store = new LocalFileStore();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips write then read', async () => {
    const path = join(dir, 'a.json');
    await store.writeFile(path, '{"x":1}');
    expect(await store.readFile(path)).toBe('{"x":1}');
  });

  it('returns null reading a missing file instead of throwing', async () => {
    expect(await store.readFile(join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null listing a missing directory instead of throwing', async () => {
    expect(await store.readdir(join(dir, 'no-such-dir'))).toBeNull();
  });

  it('mkdir is recursive and lets a nested write succeed', async () => {
    const nested = join(dir, 'deep', 'nested');
    await store.mkdir(nested);
    await store.writeFile(join(nested, 'f.txt'), 'hi');
    expect(await store.readFile(join(nested, 'f.txt'))).toBe('hi');
  });

  it('readdir lists the immediate child names', async () => {
    await store.writeFile(join(dir, 'one.json'), '1');
    await store.writeFile(join(dir, 'two.json'), '2');
    const names = await store.readdir(dir);
    expect(names?.sort()).toEqual(['one.json', 'two.json']);
  });

  it('overwrites an existing file on a second write', async () => {
    const path = join(dir, 'over.json');
    await store.writeFile(path, 'first');
    await store.writeFile(path, 'second');
    expect(await store.readFile(path)).toBe('second');
  });

  it('reports the local backend label', () => {
    expect(store.backend).toBe('local');
  });
});
