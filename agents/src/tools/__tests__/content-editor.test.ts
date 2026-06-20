import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseContentKey,
  setAtPath,
  resolveContentFile,
  editContent,
} from '../content-editor.js';

async function mkTempContentDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'airo-content-edit-'));
}

async function writeJson(dir: string, rel: string, value: unknown): Promise<string> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return abs;
}

describe('parseContentKey', () => {
  it('parses a bare root', () => {
    expect(parseContentKey('site')).toEqual({ rootSegment: 'site', path: [] });
  });

  it('parses a dotted chain', () => {
    expect(parseContentKey('home.hero.title')).toEqual({
      rootSegment: 'home',
      path: ['hero', 'title'],
    });
  });

  it('parses a list-index segment', () => {
    expect(parseContentKey('products[3].name')).toEqual({
      rootSegment: 'products',
      path: [3, 'name'],
    });
  });

  it('parses nested list-index + dotted', () => {
    expect(parseContentKey('site.nav[0].label')).toEqual({
      rootSegment: 'site',
      path: ['nav', 0, 'label'],
    });
  });

  it('rejects an empty key', () => {
    expect(parseContentKey('')).toMatchObject({ code: 'invalid-key' });
  });

  it('rejects a trailing dot', () => {
    expect(parseContentKey('home.hero.')).toMatchObject({ code: 'invalid-key' });
  });

  it('rejects unclosed bracket', () => {
    expect(parseContentKey('products[3')).toMatchObject({ code: 'invalid-key' });
  });

  it('rejects non-integer index', () => {
    expect(parseContentKey('products[a]')).toMatchObject({ code: 'invalid-key' });
  });

  it('rejects invalid characters', () => {
    expect(parseContentKey('home-hero.title')).toMatchObject({ code: 'invalid-key' });
  });

  it('rejects __proto__ segment', () => {
    expect(parseContentKey('home.__proto__.toString')).toMatchObject({ code: 'invalid-key', message: expect.stringContaining('reserved') });
  });

  it('rejects constructor segment', () => {
    expect(parseContentKey('home.constructor')).toMatchObject({ code: 'invalid-key', message: expect.stringContaining('reserved') });
  });

  it('rejects prototype segment', () => {
    expect(parseContentKey('home.prototype')).toMatchObject({ code: 'invalid-key', message: expect.stringContaining('reserved') });
  });

  it('parses deeply nested keys with mixed bracket and dot access', () => {
    expect(parseContentKey('site.nav[0].items[2].label')).toEqual({
      rootSegment: 'site',
      path: ['nav', 0, 'items', 2, 'label'],
    });
  });
});

describe('setAtPath', () => {
  it('sets a shallow field', () => {
    const doc = { brand: 'Old' };
    expect(setAtPath(doc, ['brand'], 'New')).toBeNull();
    expect(doc.brand).toBe('New');
  });

  it('sets a deep field', () => {
    const doc = { hero: { title: 'Old', subtitle: 'Sub' } };
    expect(setAtPath(doc, ['hero', 'title'], 'New')).toBeNull();
    expect(doc.hero.title).toBe('New');
    expect(doc.hero.subtitle).toBe('Sub');
  });

  it('sets a list item field', () => {
    const doc = { products: [{ name: 'A' }, { name: 'B' }] };
    expect(setAtPath(doc, ['products', 1, 'name'], 'X')).toBeNull();
    expect(doc.products[1].name).toBe('X');
    expect(doc.products[0].name).toBe('A');
  });

  it('fails when an intermediate object is missing', () => {
    const doc = {};
    const err = setAtPath(doc, ['hero', 'title'], 'X');
    expect(err).toMatchObject({ code: 'missing-path' });
  });

  it('fails when the terminal field is missing (no autovivification)', () => {
    const doc = { hero: {} };
    const err = setAtPath(doc, ['hero', 'title'], 'X');
    expect(err).toMatchObject({ code: 'missing-path' });
  });

  it('fails when list index is out of range', () => {
    const doc = { products: [{ name: 'A' }] };
    const err = setAtPath(doc, ['products', 5, 'name'], 'X');
    expect(err).toMatchObject({ code: 'missing-path' });
  });

  it('fails when expecting array but finding object', () => {
    const doc = { products: { a: 1 } };
    const err = setAtPath(doc, ['products', 0], 'X');
    expect(err).toMatchObject({ code: 'missing-path' });
  });

  it('refuses to set the document root', () => {
    expect(setAtPath({}, [], 'x')).toMatchObject({ code: 'missing-path' });
  });

  it('does not traverse inherited properties', () => {
    const doc = { hero: { title: 'Hello' } };
    const err = setAtPath(doc, ['hero', 'toString'], 'x');
    expect(err).toMatchObject({ code: 'missing-path' });
    expect(typeof ({}).toString).toBe('function');
  });
});

describe('resolveContentFile', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('resolves "site" to site.json', async () => {
    const f = await writeJson(dir, 'site.json', {});
    expect(await resolveContentFile(dir, 'site')).toBe(f);
  });

  it('resolves a page root to pages/<root>.json', async () => {
    const f = await writeJson(dir, 'pages/home.json', {});
    expect(await resolveContentFile(dir, 'home')).toBe(f);
  });

  it('resolves a data root to data/<root>.json', async () => {
    const f = await writeJson(dir, 'data/products.json', []);
    expect(await resolveContentFile(dir, 'products')).toBe(f);
  });

  it('prefers pages/ over data/ when both exist', async () => {
    const pagesFile = await writeJson(dir, 'pages/dup.json', {});
    await writeJson(dir, 'data/dup.json', []);
    expect(await resolveContentFile(dir, 'dup')).toBe(pagesFile);
  });

  it('returns an error when no file matches', async () => {
    const result = await resolveContentFile(dir, 'nope');
    expect(result).toMatchObject({ code: 'unknown-root' });
  });
});

describe('editContent', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('edits a simple page field end-to-end', async () => {
    const file = await writeJson(dir, 'pages/home.json', { hero: { title: 'Old' } });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'New',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.hero.title).toBe('New');
  });

  it('edits a list item field', async () => {
    const file = await writeJson(dir, 'data/products.json', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    const result = await editContent(dir, {
      contentKey: 'products[1].name',
      kind: 'copy',
      value: 'New B',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read[1].name).toBe('New B');
    expect(read[0].name).toBe('A');
  });

  it('rejects a missing root with unknown-root', async () => {
    const result = await editContent(dir, {
      contentKey: 'nonexistent.field',
      kind: 'copy',
      value: 'x',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-root' } });
  });

  it('rejects a missing path with missing-path (no autovivification)', async () => {
    await writeJson(dir, 'pages/home.json', { hero: {} });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'x',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'missing-path' } });
  });

  it('rejects non-string values', async () => {
    await writeJson(dir, 'site.json', { brand: 'x' });
    const result = await editContent(dir, {
      contentKey: 'site.brand',
      kind: 'copy',
      value: 42 as unknown as string,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('preserves untouched fields', async () => {
    const file = await writeJson(dir, 'pages/home.json', {
      hero: { title: 'Old', subtitle: 'Sub', image: { src: '/x.jpg', alt: 'alt' } },
      other: 'untouched',
    });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'New',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read).toEqual({
      hero: { title: 'New', subtitle: 'Sub', image: { src: '/x.jpg', alt: 'alt' } },
      other: 'untouched',
    });
  });

  it('does not leave a .tmp file behind on success', async () => {
    await writeJson(dir, 'site.json', { brand: 'x' });
    await editContent(dir, { contentKey: 'site.brand', kind: 'copy', value: 'y' });
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('edits only the targeted array index, leaving siblings intact', async () => {
    const file = await writeJson(dir, 'data/products.json', [
      { name: 'A' }, { name: 'B' }, { name: 'C' },
    ]);
    const res = await editContent(dir, { contentKey: 'products[1].name', kind: 'copy', value: 'B2' });
    expect(res.ok).toBe(true);
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.map((p: { name: string }) => p.name)).toEqual(['A', 'B2', 'C']);
  });

  it('returns parse-failed when the backing file contains malformed JSON', async () => {
    const filePath = path.join(dir, 'pages', 'home.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{ bad json', 'utf8');
    const result = await editContent(dir, { contentKey: 'home.hero.title', kind: 'copy', value: 'x' });
    expect(result).toMatchObject({ ok: false, error: { code: 'parse-failed' } });
  });

  it('returns read-failed when the backing content file is a directory (EISDIR)', async () => {
    // Make pages/home.json a directory so readFile throws EISDIR — resolveContentFile
    // still returns the path (fileExists resolves for directories), but readFile fails.
    const dataFile = path.join(dir, 'pages', 'home.json');
    await fs.mkdir(dataFile, { recursive: true });
    const result = await editContent(dir, { contentKey: 'home.hero.title', kind: 'copy', value: 'x' });
    expect(result).toMatchObject({ ok: false, error: { code: 'read-failed' } });
  });

  it('returns write-failed when atomicWrite rejects', async () => {
    await writeJson(dir, 'pages/home.json', { hero: { title: 'Old' } });
    const fsUtils = await import('../../utils/fs-utils.js');
    const spy = vi.spyOn(fsUtils, 'atomicWrite').mockRejectedValueOnce(new Error('disk full'));
    try {
      const result = await editContent(dir, { contentKey: 'home.hero.title', kind: 'copy', value: 'New' });
      expect(result).toMatchObject({ ok: false, error: { code: 'write-failed' } });
    } finally {
      spy.mockRestore();
    }
  });
});
