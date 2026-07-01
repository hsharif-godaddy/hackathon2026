import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseContentKey,
  isIdRef,
  setAtPath,
  resolveContentFile,
  editContent,
} from '../content-editor.js';
import { readUserLocks, USER_EDITS_FILE } from '../content-user-edits.js';
import { scaffoldContent } from '../content-scaffold.js';

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

  it('coerces a numeric string into an existing number field', () => {
    const doc = { products: [{ price: 19.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], '24.5')).toBeNull();
    expect(doc.products[0].price).toBe(24.5);
    expect(typeof doc.products[0].price).toBe('number');
  });

  it('preserves integers when coercing', () => {
    const doc = { stats: { count: 3 } };
    expect(setAtPath(doc, ['stats', 'count'], '10')).toBeNull();
    expect(doc.stats.count).toBe(10);
  });

  it('rejects a non-numeric string for a number field with invalid-value', () => {
    const doc = { products: [{ price: 9.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], 'abc')).toMatchObject({ code: 'invalid-value' });
    expect(doc.products[0].price).toBe(9.99);
  });

  it('rejects an empty string for a number field', () => {
    const doc = { products: [{ price: 9.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], '   ')).toMatchObject({ code: 'invalid-value' });
  });

  it('rejects Infinity/NaN-producing input for a number field', () => {
    const doc = { products: [{ price: 9.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], 'Infinity')).toMatchObject({ code: 'invalid-value' });
  });

  it('rejects a regex-valid decimal that overflows to Infinity', () => {
    const doc = { products: [{ price: 9.99 }] };
    const huge = '1' + '0'.repeat(309);
    expect(setAtPath(doc, ['products', 0, 'price'], huge)).toMatchObject({ code: 'invalid-value' });
    expect(doc.products[0].price).toBe(9.99);
  });

  it('rejects hex notation for a number field with invalid-value, field unchanged', () => {
    const doc = { products: [{ price: 9.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], '0x1F')).toMatchObject({ code: 'invalid-value' });
    expect(doc.products[0].price).toBe(9.99);
  });

  it('rejects scientific notation for a number field with invalid-value, field unchanged', () => {
    const doc = { products: [{ price: 9.99 }] };
    expect(setAtPath(doc, ['products', 0, 'price'], '1e2')).toMatchObject({ code: 'invalid-value' });
    expect(doc.products[0].price).toBe(9.99);
  });

  it('accepts a negative decimal string for a number field', () => {
    const doc = { stats: { delta: 0 } };
    expect(setAtPath(doc, ['stats', 'delta'], '-5')).toBeNull();
    expect(doc.stats.delta).toBe(-5);
  });

  it('rejects a null-valued field as type-unsupported', () => {
    const doc = { settings: { threshold: null } };
    expect(setAtPath(doc, ['settings', 'threshold'], 'x')).toMatchObject({ code: 'type-unsupported' });
  });

  it('writes a string field verbatim (copy path unchanged)', () => {
    const doc = { hero: { title: 'Old' } };
    expect(setAtPath(doc, ['hero', 'title'], '42')).toBeNull();
    expect(doc.hero.title).toBe('42'); // stays a string
  });

  it('rejects editing a boolean field as type-unsupported', () => {
    const doc = { flags: { featured: true } };
    expect(setAtPath(doc, ['flags', 'featured'], 'false')).toMatchObject({ code: 'type-unsupported' });
    expect(doc.flags.featured).toBe(true);
  });

  it('rejects editing an object/array field as type-unsupported', () => {
    const doc = { hero: { image: { src: '/x.jpg' } } };
    expect(setAtPath(doc, ['hero', 'image'], 'nope')).toMatchObject({ code: 'type-unsupported' });
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

  it('edits a nested leaf via id-anchored [@id] keys end-to-end and records the id lock', async () => {
    const file = await writeJson(dir, 'data/menu.json', {
      categories: [
        { id: 'mains', items: [{ id: 'burger', price: '10' }, { id: 'fries', price: '4' }] },
      ],
    });
    const result = await editContent(dir, {
      contentKey: 'menu.categories[@mains].items[@burger].price',
      kind: 'copy',
      value: '12',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.categories[0].items[0].price).toBe('12'); // burger, reached via two intermediate id-refs
    expect(read.categories[0].items[1].price).toBe('4'); // fries untouched
    // recordUserLock persists the id-anchored key verbatim
    const locks = JSON.parse(await fs.readFile(path.join(dir, '.user-edits.json'), 'utf8'));
    expect(locks.lockedKeys).toContain('menu.categories[@mains].items[@burger].price');
  });

  it('returns missing-path when an [@id] segment matches no item', async () => {
    await writeJson(dir, 'data/menu.json', { items: [{ id: 'a', price: '1' }] });
    const result = await editContent(dir, {
      contentKey: 'menu.items[@nope].price',
      kind: 'copy',
      value: '9',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'missing-path' } });
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

  it('edits a numeric list-item field and preserves the number type', async () => {
    const file = await writeJson(dir, 'data/products.json', [
      { id: 'a', name: 'A', price: 9.99 },
      { id: 'b', name: 'B', price: 19.99 },
    ]);
    const result = await editContent(dir, { contentKey: 'products[1].price', kind: 'copy', value: '24.5' });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read[1].price).toBe(24.5);
    expect(typeof read[1].price).toBe('number');
    expect(read[0].price).toBe(9.99);
  });

  it('rejects a non-numeric edit to a numeric field, leaving the file unchanged', async () => {
    const file = await writeJson(dir, 'data/products.json', [{ id: 'a', price: 9.99 }]);
    const result = await editContent(dir, { contentKey: 'products[0].price', kind: 'copy', value: 'free' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read[0].price).toBe(9.99);
  });

  it('returns type-unsupported for a boolean field, leaving the file unchanged', async () => {
    const file = await writeJson(dir, 'data/products.json', [
      { id: 'a', name: 'Widget', featured: true },
    ]);
    const result = await editContent(dir, {
      contentKey: 'products[0].featured',
      kind: 'copy',
      value: 'false',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'type-unsupported' } });
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read[0].featured).toBe(true);
  });

  it('records the edited key as a user lock on success', async () => {
    await writeJson(dir, 'pages/home.json', { hero: { title: 'Old' } });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'New',
    });
    expect(result.ok).toBe(true);
    expect(await readUserLocks(dir)).toEqual(['home.hero.title']);
  });

  it('does NOT record a lock on a rejected edit (invalid numeric value)', async () => {
    await writeJson(dir, 'data/products.json', [{ id: 'a', price: 9.99 }]);
    const result = await editContent(dir, {
      contentKey: 'products[0].price',
      kind: 'copy',
      value: 'free',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
    // No lock file should exist, and reading locks yields [].
    await expect(fs.access(path.join(dir, USER_EDITS_FILE))).rejects.toThrow();
    expect(await readUserLocks(dir)).toEqual([]);
  });
});

describe('editContent derived-edit guard (expectedCurrent)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('writes when expectedCurrent matches the stored string', async () => {
    const file = await writeJson(dir, 'pages/home.json', { hero: { title: 'Welcome' } });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'Hello',
      expectedCurrent: 'Welcome',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.hero.title).toBe('Hello');
  });

  it('writes when expectedCurrent matches a stored number via String coercion (still coerces to number)', async () => {
    const file = await writeJson(dir, 'data/products.json', [{ id: 'a', count: 5 }]);
    const result = await editContent(dir, {
      contentKey: 'products[0].count',
      kind: 'copy',
      value: '6',
      expectedCurrent: '5',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read[0].count).toBe(6);
    expect(typeof read[0].count).toBe('number');
  });

  it('returns derived-mismatch and leaves the file unchanged when expectedCurrent does not match', async () => {
    const file = await writeJson(dir, 'pages/home.json', { price: 5 });
    const result = await editContent(dir, {
      contentKey: 'home.price',
      kind: 'copy',
      value: '6',
      expectedCurrent: '$5.00',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'derived-mismatch' } });
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.price).toBe(5);
  });

  it('a matching stored boolean passes the guard, then coerce rejects with type-unsupported (not derived-mismatch)', async () => {
    // The guard only compares stringified scalars; a boolean that matches
    // expectedCurrent gets past it and is then correctly refused by
    // coerceToExistingType (booleans aren't inline-editable).
    const file = await writeJson(dir, 'pages/home.json', { flags: { active: true } });
    const result = await editContent(dir, {
      contentKey: 'home.flags.active',
      kind: 'copy',
      value: 'false',
      expectedCurrent: 'true',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'type-unsupported' } });
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.flags.active).toBe(true);
  });

  it('behaves exactly as before when expectedCurrent is omitted (backward-compat)', async () => {
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

  it('matches whitespace-insensitively (settled animated value)', async () => {
    const file = await writeJson(dir, 'pages/home.json', { stat: '500+' });
    const result = await editContent(dir, {
      contentKey: 'home.stat',
      kind: 'copy',
      value: '600+',
      expectedCurrent: '  500+ ',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.stat).toBe('600+');
  });

  it('writes an indexed key when the guard matches', async () => {
    const file = await writeJson(dir, 'pages/home.json', {
      about: { stats: [{ value: '500+' }, { value: '20+' }] },
    });
    const result = await editContent(dir, {
      contentKey: 'home.about.stats[0].value',
      kind: 'copy',
      value: '600+',
      expectedCurrent: '500+',
    });
    expect(result.ok).toBe(true);
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.about.stats[0].value).toBe('600+');
    expect(read.about.stats[1].value).toBe('20+');
  });

  it('returns derived-mismatch on an indexed key when the guard does not match, file unchanged', async () => {
    const file = await writeJson(dir, 'pages/home.json', {
      about: { stats: [{ value: '500+' }] },
    });
    const result = await editContent(dir, {
      contentKey: 'home.about.stats[0].value',
      kind: 'copy',
      value: '600+',
      expectedCurrent: '999+',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'derived-mismatch' } });
    const read = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(read.about.stats[0].value).toBe('500+');
  });

  it('returns missing-path (guard skipped), not derived-mismatch, when the path is absent', async () => {
    await writeJson(dir, 'pages/home.json', { hero: {} });
    const result = await editContent(dir, {
      contentKey: 'home.hero.title',
      kind: 'copy',
      value: 'x',
      expectedCurrent: 'anything',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'missing-path' } });
  });
});

describe('editContent → scaffoldContent lock round-trip (CP1 read agrees with CP3 write)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTempContentDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('preserves a user-edited collection field when the agent regenerates the root with a different value', async () => {
    const file = await writeJson(dir, 'data/menu.json', {
      dishes: [{ name: 'Soup', price: 8.0 }],
    });

    // 1. User inline-edits the price → records lock home for menu.dishes[0].price.
    const edit = await editContent(dir, {
      contentKey: 'menu.dishes[0].price',
      kind: 'copy',
      value: '12.5',
    });
    expect(edit.ok).toBe(true);
    expect(await readUserLocks(dir)).toContain('menu.dishes[0].price');

    // 2. Agent regenerates the menu collection with a DIFFERENT price and a NEW field.
    const scaffold = await scaffoldContent(dir, {
      kind: 'collection',
      name: 'menu',
      content: {
        dishes: [{ name: 'Soup', price: 6.0, spicy: true }],
      },
    });
    expect(scaffold.ok).toBe(true);

    // 3. The user's edited price wins; the agent's new field is added.
    const merged = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(merged.dishes[0].price).toBe(12.5); // user edit preserved
    expect(merged.dishes[0].name).toBe('Soup');
    expect(merged.dishes[0].spicy).toBe(true); // new field added
  });
});

describe('setAtPath id-ref resolution', () => {
  it('sets a leaf addressed by item id', () => {
    const doc = { items: [{ id: 'a', price: '1' }, { id: 'b', price: '2' }] };
    const err = setAtPath(doc, ['items', { id: 'b' }, 'price'], '9');
    expect(err).toBeNull();
    expect(doc.items[1].price).toBe('9');
    expect(doc.items[0].price).toBe('1');
  });

  it('returns missing-path when no item has the id', () => {
    const doc = { items: [{ id: 'a', price: '1' }] };
    const err = setAtPath(doc, ['items', { id: 'zzz' }, 'price'], '9');
    expect(err?.code).toBe('missing-path');
    expect(err?.message).toMatch(/zzz/);
  });

  it('still resolves positional indices unchanged', () => {
    const doc = { items: [{ price: '1' }] };
    const err = setAtPath(doc, ['items', 0, 'price'], '5');
    expect(err).toBeNull();
    expect(doc.items[0].price).toBe('5');
  });

  it('returns missing-path when an id-ref parent is not an array', () => {
    const doc = { x: 'str' };
    const err = setAtPath(doc, [{ id: 'a' }], 'v');
    expect(err?.code).toBe('missing-path');
  });
});

describe('parseContentKey [@id] segments', () => {
  it('parses an @id index into an id-ref segment', () => {
    const r = parseContentKey('menu.items[@burger].price');
    expect('code' in r).toBe(false);
    if ('code' in r) return;
    expect(r.rootSegment).toBe('menu');
    expect(r.path).toEqual(['items', { id: 'burger' }, 'price']);
  });

  it('allows base64url id charset (A-Za-z0-9_-)', () => {
    const r = parseContentKey('data.rows[@aB9_-x].name');
    if ('code' in r) throw new Error(r.message);
    expect(r.path).toEqual(['rows', { id: 'aB9_-x' }, 'name']);
  });

  it('coexists with positional indices in one key', () => {
    const r = parseContentKey('a.b[0].c[@x].d');
    if ('code' in r) throw new Error(r.message);
    expect(r.path).toEqual(['b', 0, 'c', { id: 'x' }, 'd']);
  });

  it('rejects an empty id (@ with no chars)', () => {
    const r = parseContentKey('a.b[@].c');
    expect('code' in r && r.code).toBe('invalid-key');
  });

  it('rejects an invalid id char', () => {
    const r = parseContentKey('a.b[@no.dot].c');
    expect('code' in r && r.code).toBe('invalid-key');
  });

  it('rejects @id as the root segment', () => {
    const r = parseContentKey('[@x].foo');
    expect('code' in r && r.code).toBe('invalid-key');
  });

  it('parses a path ending in an id-ref', () => {
    const r = parseContentKey('a[@x]');
    if ('code' in r) throw new Error(r.message);
    expect(r.path).toEqual([{ id: 'x' }]);
  });

  it('isIdRef discriminates segment kinds', () => {
    expect(isIdRef({ id: 'x' })).toBe(true);
    expect(isIdRef(3)).toBe(false);
    expect(isIdRef('x')).toBe(false);
  });
});
