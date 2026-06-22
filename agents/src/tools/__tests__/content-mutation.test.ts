import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertItem, removeItem, reorderItems, mutateContent } from '../content-mutation.js';
import type { ContentPathSegment } from '../content-editor.js';

const ITEMS: ContentPathSegment[] = ['menu', 'items'];

function doc(): { menu: { items: Array<{ id: string; name: string }> } } {
  return { menu: { items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } };
}

describe('insertItem', () => {
  it('appends when afterId omitted and mints an id', () => {
    const d = doc();
    const r = insertItem(d, ITEMS, { name: 'C' });
    expect('id' in r).toBe(true);
    const id = (r as { id: string }).id;
    expect(d.menu.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
    expect(d.menu.items[2]!.id).toBe(id);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('inserts after the given id', () => {
    const d = doc();
    insertItem(d, ITEMS, { name: 'C' }, 'a');
    expect(d.menu.items.map((i) => i.name)).toEqual(['A', 'C', 'B']);
  });

  it('inserts into an empty array', () => {
    const d: { menu: { items: unknown[] } } = { menu: { items: [] } };
    const r = insertItem(d, ITEMS, { name: 'C' });
    expect('id' in r).toBe(true);
    expect(d.menu.items).toHaveLength(1);
  });

  it('overwrites a caller-supplied id with a minted one', () => {
    const d = doc();
    const r = insertItem(d, ITEMS, { id: 'a', name: 'C' });
    const id = (r as { id: string }).id;
    expect(id).not.toBe('a');
    expect(new Set(d.menu.items.map((i) => i.id)).size).toBe(3);
  });

  it('mints ids for nested collection items', () => {
    const d = doc();
    insertItem(d, ITEMS, { name: 'C', tags: [{ label: 'x' }] });
    const inserted = d.menu.items[2] as unknown as { tags: Array<{ id?: string }> };
    expect(typeof inserted.tags[0]!.id).toBe('string');
  });

  it('rejects a non-object item', () => {
    const r = insertItem(doc(), ITEMS, 'nope');
    expect(r).toMatchObject({ code: 'invalid-item' });
  });

  it('errors when target is not an array', () => {
    const r = insertItem({ menu: { items: {} } }, ITEMS, { name: 'C' });
    expect(r).toMatchObject({ code: 'not-an-array' });
  });

  it('errors when afterId is absent', () => {
    const r = insertItem(doc(), ITEMS, { name: 'C' }, 'zzz');
    expect(r).toMatchObject({ code: 'item-not-found' });
  });
});

describe('removeItem', () => {
  it('removes the matching item', () => {
    const d = doc();
    expect(removeItem(d, ITEMS, 'a')).toBeNull();
    expect(d.menu.items.map((i) => i.id)).toEqual(['b']);
  });

  it('errors when id is absent', () => {
    expect(removeItem(doc(), ITEMS, 'zzz')).toMatchObject({ code: 'item-not-found' });
  });

  it('errors when target is not an array', () => {
    expect(removeItem({ menu: { items: 5 } }, ITEMS, 'a')).toMatchObject({ code: 'not-an-array' });
  });
});

describe('reorderItems', () => {
  it('reorders by id', () => {
    const d = doc();
    expect(reorderItems(d, ITEMS, ['b', 'a'])).toBeNull();
    expect(d.menu.items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('rejects a missing id', () => {
    expect(reorderItems(doc(), ITEMS, ['a'])).toMatchObject({ code: 'invalid-order' });
  });

  it('rejects an extra id', () => {
    expect(reorderItems(doc(), ITEMS, ['a', 'b', 'c'])).toMatchObject({ code: 'invalid-order' });
  });

  it('rejects a duplicate id', () => {
    expect(reorderItems(doc(), ITEMS, ['a', 'a'])).toMatchObject({ code: 'invalid-order' });
  });

  it('rejects when an item lacks a string id', () => {
    const d = { menu: { items: [{ name: 'A' }, { id: 'b', name: 'B' }] } };
    expect(reorderItems(d, ITEMS, ['b'])).toMatchObject({ code: 'invalid-order' });
  });

  it('errors when target is not an array', () => {
    expect(reorderItems({ menu: { items: null } }, ITEMS, [])).toMatchObject({ code: 'not-an-array' });
  });
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cms-mut-'));
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(
    join(dir, 'pages', 'home.json'),
    JSON.stringify({ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }),
  );
  return dir;
}

describe('mutateContent', () => {
  it('inserts and records no item-level lock', async () => {
    const dir = await fixture();
    const r = await mutateContent(dir, { op: 'insert', collectionKey: 'home.items', item: { name: 'C' } });
    expect(r.ok).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, 'pages', 'home.json'), 'utf8'));
    expect(onDisk.items).toHaveLength(3);
    // no lock file written for a bare insert
    await expect(readFile(join(dir, '.user-edits.json'), 'utf8')).rejects.toThrow();
  });

  it('rekeys a positional lock to id-anchored before mutating', async () => {
    const dir = await fixture();
    await writeFile(join(dir, '.user-edits.json'), JSON.stringify({ lockedKeys: ['home.items[1].name'] }));
    await mutateContent(dir, { op: 'reorder', collectionKey: 'home.items', order: ['b', 'a'] });
    const locks = JSON.parse(await readFile(join(dir, '.user-edits.json'), 'utf8'));
    expect(locks.lockedKeys).toContain('home.items[@b].name');
  });

  it('a positional lock on a surviving item follows it across an insert (rekey before mutate)', async () => {
    const dir = await fixture();
    // Lock item b by position; b is at index 1 in the pre-mutation array.
    await writeFile(join(dir, '.user-edits.json'), JSON.stringify({ lockedKeys: ['home.items[1].name'] }));
    // Insert after a → on-disk order becomes [a, C, b]; b shifts to index 2.
    await mutateContent(dir, { op: 'insert', collectionKey: 'home.items', item: { name: 'C' }, afterId: 'a' });
    const locks = JSON.parse(await readFile(join(dir, '.user-edits.json'), 'utf8'));
    // The lock must anchor to b's id (rekeyed from [1] BEFORE the insert shifted it),
    // not to a stale position — [1] would now point at the new item C, [2] at b.
    expect(locks.lockedKeys).toContain('home.items[@b].name');
    expect(locks.lockedKeys).not.toContain('home.items[1].name');
    const onDisk = JSON.parse(await readFile(join(dir, 'pages', 'home.json'), 'utf8'));
    expect(onDisk.items.map((i: { id: string }) => i.id)).toEqual(['a', expect.any(String), 'b']);
  });

  it('rekeys both surviving siblings under a reorder', async () => {
    const dir = await fixture();
    await writeFile(
      join(dir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: ['home.items[0].name', 'home.items[1].name'] }),
    );
    await mutateContent(dir, { op: 'reorder', collectionKey: 'home.items', order: ['b', 'a'] });
    const locks = JSON.parse(await readFile(join(dir, '.user-edits.json'), 'utf8'));
    // Both positional locks rekey to their item's id from the PRE-reorder positions
    // (index 0 → a, index 1 → b); the id anchors then survive the reshuffle.
    expect(locks.lockedKeys).toContain('home.items[@a].name');
    expect(locks.lockedKeys).toContain('home.items[@b].name');
  });

  it('prunes the removed item\'s locks', async () => {
    const dir = await fixture();
    await writeFile(
      join(dir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: ['home.items[@a].name', 'home.items[@b].name'] }),
    );
    await mutateContent(dir, { op: 'remove', collectionKey: 'home.items', itemId: 'a' });
    const locks = JSON.parse(await readFile(join(dir, '.user-edits.json'), 'utf8'));
    expect(locks.lockedKeys).toEqual(['home.items[@b].name']);
  });

  it('scopes prune to the mutated collection — a same-id item in another collection keeps its lock', async () => {
    const dir = await fixture();
    // `.user-edits.json` is global: both collections happen to hold an item with id "a".
    await writeFile(
      join(dir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: ['home.items[@a].name', 'products[@a].title'] }),
    );
    await mutateContent(dir, { op: 'remove', collectionKey: 'home.items', itemId: 'a' });
    const locks = JSON.parse(await readFile(join(dir, '.user-edits.json'), 'utf8'));
    // home.items[@a] pruned; the unrelated products[@a] lock must survive.
    expect(locks.lockedKeys).toEqual(['products[@a].title']);
  });

  it('returns not-an-array for a non-array key', async () => {
    const dir = await fixture();
    const r = await mutateContent(dir, { op: 'remove', collectionKey: 'home', itemId: 'a' });
    expect(r).toMatchObject({ ok: false, error: { code: 'not-an-array' } });
  });
});
