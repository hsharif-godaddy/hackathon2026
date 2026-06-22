import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  scaffoldContent,
  resolveKey,
  resolveFilePath,
  inferZodSchema,
  patchSchemasFile,
  ensureContentPluginRegistered,
  applyLocks,
  normalizeContent,
  ensureCollectionIds,
  validateCollectionIds,
  rekeyPositionalLocks,
  inheritExistingIds,
} from '../content-scaffold.js';
import { readUserLocks } from '../content-user-edits.js';
import * as contentUserEdits from '../content-user-edits.js';

async function mkTempContent(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airo-scaffold-'));
  return path.join(root, 'src', 'content');
}

describe('resolveKey', () => {
  it('uses the fixed "site" key regardless of name for kind=site', () => {
    expect(resolveKey('site', undefined)).toBe('site');
    expect(resolveKey('site', 'ignored')).toBe('site');
  });

  it('returns the name for kind=page', () => {
    expect(resolveKey('page', 'home')).toBe('home');
  });

  it('returns the name for kind=collection', () => {
    expect(resolveKey('collection', 'products')).toBe('products');
  });

  it('rejects names with spaces', () => {
    expect(resolveKey('page', 'my page')).toMatchObject({ code: 'invalid-name' });
  });

  it('rejects names starting with a digit', () => {
    expect(resolveKey('page', '123abc')).toMatchObject({ code: 'invalid-name' });
  });

  it('rejects uppercase names (enforces lowercase convention)', () => {
    expect(resolveKey('page', 'Home')).toMatchObject({ code: 'invalid-name' });
  });

  it('rejects empty name for non-site kinds', () => {
    expect(resolveKey('page', '')).toMatchObject({ code: 'invalid-name' });
    expect(resolveKey('page', undefined)).toMatchObject({ code: 'invalid-name' });
  });

  it('rejects reserved JS property names', () => {
    expect(resolveKey('page', '__proto__')).toMatchObject({ code: 'invalid-name' });
    expect(resolveKey('page', 'constructor')).toMatchObject({ code: 'invalid-name' });
    expect(resolveKey('page', 'prototype')).toMatchObject({ code: 'invalid-name' });
    expect(resolveKey('collection', '__proto__')).toMatchObject({ code: 'invalid-name' });
  });

  it('rejects unknown kind', () => {
    expect(resolveKey('weird' as unknown as 'page', 'home')).toMatchObject({ code: 'invalid-kind' });
  });
});

describe('resolveFilePath', () => {
  it('maps site → <contentDir>/site.json', () => {
    expect(resolveFilePath('/x/content', 'site', 'site')).toBe('/x/content/site.json');
  });

  it('maps page → <contentDir>/pages/<name>.json', () => {
    expect(resolveFilePath('/x/content', 'page', 'home')).toBe('/x/content/pages/home.json');
  });

  it('maps collection → <contentDir>/data/<name>.json', () => {
    expect(resolveFilePath('/x/content', 'collection', 'products')).toBe(
      '/x/content/data/products.json',
    );
  });
});

describe('inferZodSchema', () => {
  it('infers primitives', () => {
    expect(inferZodSchema('x')).toBe('z.string()');
    expect(inferZodSchema(42)).toBe('z.number()');
    expect(inferZodSchema(true)).toBe('z.boolean()');
  });

  it('infers flat objects', () => {
    expect(inferZodSchema({ brand: 'x', year: 2024 })).toBe(
      'z.object({ "brand": z.string(), "year": z.number() })',
    );
  });

  it('infers nested objects', () => {
    expect(inferZodSchema({ hero: { title: 'x' } })).toBe(
      'z.object({ "hero": z.object({ "title": z.string() }) })',
    );
  });

  it('infers arrays from the first item', () => {
    expect(inferZodSchema([{ id: 'a', name: 'A' }])).toBe(
      'z.array(z.object({ "id": z.string(), "name": z.string() }))',
    );
  });

  it('infers empty arrays as z.array(z.unknown())', () => {
    expect(inferZodSchema([])).toBe('z.array(z.unknown())');
  });

  it('infers empty objects as z.object({})', () => {
    expect(inferZodSchema({})).toBe('z.object({})');
  });

  it('throws on null values (ambiguous)', () => {
    expect(() => inferZodSchema(null)).toThrow(/null/);
  });

  it('throws on undefined values', () => {
    expect(() => inferZodSchema(undefined)).toThrow(/undefined/);
  });

  it('throws on null nested inside an object', () => {
    expect(() => inferZodSchema({ a: null })).toThrow(/null/);
  });

  describe('inferZodSchema id requirement', () => {
    it('adds required id to an object-array element schema lacking it', () => {
      const code = inferZodSchema({ items: [{ name: 'a' }] });
      expect(code).toContain('z.array(z.object({');
      expect(code).toContain('"id": z.string()');
    });
    it('does not duplicate id when already present', () => {
      const code = inferZodSchema({ items: [{ id: 'x', name: 'a' }] });
      expect(code.match(/"id": z\.string\(\)/g)?.length).toBe(1);
    });
    it('leaves primitive arrays unchanged', () => {
      expect(inferZodSchema({ tags: ['a'] })).toContain('z.array(z.string())');
    });
  });
});

describe('patchSchemasFile', () => {
  const base = `import { z } from 'zod';\n\nexport const schemas = {};\n\nexport type Schemas = typeof schemas;\n`;

  it('adds a new key to an empty schemas object', () => {
    const out = patchSchemasFile(base, 'home', 'z.object({ title: z.string() })');
    expect(out).toMatch(/home:\s*z\.object\(\s*\{\s*title:\s*z\.string\(\)\s*\}\s*\)/);
  });

  it('replaces an existing key in place (idempotency)', () => {
    const once = patchSchemasFile(base, 'home', 'z.string()');
    const twice = patchSchemasFile(once, 'home', 'z.number()');
    expect(twice).toMatch(/home:\s*z\.number\(\)/);
    expect(twice).not.toMatch(/home:\s*z\.string\(\)/);
  });

  it('preserves other keys when patching', () => {
    const withHome = patchSchemasFile(base, 'home', 'z.string()');
    const withBoth = patchSchemasFile(withHome, 'site', 'z.object({})');
    expect(withBoth).toMatch(/home:\s*z\.string\(\)/);
    expect(withBoth).toMatch(/site:\s*z\.object\(\s*\{\s*\}\s*\)/);
  });

  it('throws when schemas.ts has no `export const schemas` object literal', () => {
    const bad = `import { z } from 'zod';\nexport default z.object({});\n`;
    expect(() => patchSchemasFile(bad, 'home', 'z.string()')).toThrow(/object literal/);
  });

  it('throws when schemas is declared as a non-object-literal value', () => {
    const bad = `export const schemas = getSchemas();\n`;
    expect(() => patchSchemasFile(bad, 'home', 'z.string()')).toThrow(/object literal/);
  });
});

describe('ensureContentPluginRegistered', () => {
  const PRE_CMS_CONFIG = `
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import sourceMapperPlugin from "./source-mapper/src/index";

export default defineConfig(({ mode }) => ({
  plugins: ([
    react({
      babel: { plugins: [sourceMapperPlugin] },
    }),
    serverBundlePlugin(),
  ] as any[]),
  resolve: { dedupe: ["react"] },
}));
`.trimStart();

  const TEMPLATE_CONFIG = `
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import sourceMapperPlugin from "./source-mapper/src/index";
import { contentPlugin } from "./content-plugin/src/index";

export default defineConfig(({ mode }) => ({
  plugins: [
    contentPlugin(),
    react({
      babel: { plugins: [sourceMapperPlugin] },
    }),
    serverBundlePlugin(),
  ],
  resolve: { dedupe: ["react"] },
}));
`.trimStart();

  it('adds import + plugin call to a config without contentPlugin', () => {
    const result = ensureContentPluginRegistered(PRE_CMS_CONFIG);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('import { contentPlugin } from "./content-plugin/src/index"');
    expect(result.code).toContain('contentPlugin()');
  });

  it('is a no-op when contentPlugin is already registered', () => {
    const result = ensureContentPluginRegistered(TEMPLATE_CONFIG);
    expect(result.modified).toBe(false);
    expect(result.code).toBe(TEMPLATE_CONFIG);
  });

  it('handles defineConfig({...}) without arrow function', () => {
    const source = `
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`.trimStart();
    const result = ensureContentPluginRegistered(source);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('contentPlugin()');
    expect(result.code).toContain('import { contentPlugin } from "./content-plugin/src/index"');
  });

  it('handles bare export default {...}', () => {
    const source = `
import react from "@vitejs/plugin-react";

export default {
  plugins: [react()],
};
`.trimStart();
    const result = ensureContentPluginRegistered(source);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('contentPlugin()');
    expect(result.code).toContain('import { contentPlugin } from "./content-plugin/src/index"');
  });

  it('places contentPlugin() first in the plugins array', () => {
    const result = ensureContentPluginRegistered(PRE_CMS_CONFIG);
    expect(result.modified).toBe(true);
    const pluginIdx = result.code.indexOf('contentPlugin()');
    const reactIdx = result.code.indexOf('react(');
    expect(pluginIdx).toBeGreaterThan(-1);
    expect(pluginIdx).toBeLessThan(reactIdx);
  });

  it('preserves existing plugins after contentPlugin()', () => {
    const result = ensureContentPluginRegistered(PRE_CMS_CONFIG);
    expect(result.modified).toBe(true);
    expect(result.code).toContain('react(');
    expect(result.code).toContain('serverBundlePlugin()');
  });
});

describe('normalizeContent', () => {
  it('parses a stringified JSON object into an object', () => {
    expect(normalizeContent('{"hero":{"title":"Hi"}}')).toEqual({ hero: { title: 'Hi' } });
  });

  it('parses a stringified JSON array into an array', () => {
    expect(normalizeContent('[{"id":"a","price":10}]')).toEqual([{ id: 'a', price: 10 }]);
  });

  it('leaves an actual object unchanged', () => {
    const obj = { hero: { title: 'Hi' } };
    expect(normalizeContent(obj)).toEqual(obj);
  });

  it('leaves an actual array unchanged', () => {
    expect(normalizeContent([{ id: 'a' }])).toEqual([{ id: 'a' }]);
  });

  it('keeps a non-JSON string as a string (legit string value)', () => {
    expect(normalizeContent('just some copy')).toBe('just some copy');
  });

  it('does NOT promote a stringified JSON primitive (only objects/arrays)', () => {
    expect(normalizeContent('"hi"')).toBe('"hi"');
    expect(normalizeContent('42')).toBe('42');
  });

  it('leaves non-string values (number, boolean) unchanged', () => {
    expect(normalizeContent(42)).toBe(42);
    expect(normalizeContent(true)).toBe(true);
  });
});

describe('scaffoldContent (end-to-end)', () => {
  let contentDir: string;

  beforeEach(async () => { contentDir = await mkTempContent(); });
  afterEach(async () => {
    await fs.rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  it('creates schemas.ts + content file for a fresh page', async () => {
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Hi' } },
    });
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    expect(result.file).toBe(path.join(contentDir, 'pages/home.json'));
    expect(result.importLine).toBe(`import { home } from 'virtual:content';`);
    expect(result.schemasCreated).toBe(true);
    expect(result.key).toBe('home');

    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    expect(schemasSource).toMatch(/import\s*{\s*z\s*}\s*from\s*['"]zod['"]/);
    expect(schemasSource).toMatch(/home:\s*z\.object/);

    const written = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(written).toEqual({ hero: { title: 'Hi' } });
  });

  it('normalizes a stringified-JSON content arg into a real object file + object schema', async () => {
    // Reproduces the live bug: the agent passed `content` as a JSON STRING, so
    // the tool wrote a quoted string file and inferred z.string().
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: JSON.stringify({ title: 'Menu', items: [{ name: 'Drip', price: '$4' }] }),
    });
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    const written = JSON.parse(await fs.readFile(result.file, 'utf8'));
    // id is now minted on collection items — check shape, not exact equality
    expect(written.title).toBe('Menu');
    expect(written.items).toHaveLength(1);
    expect(written.items[0]).toMatchObject({ name: 'Drip', price: '$4' });
    expect(typeof written.items[0].id).toBe('string');
    expect(typeof written).toBe('object');

    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    expect(schemasSource).toMatch(/menu:\s*z\.object/);
    expect(schemasSource).not.toMatch(/menu:\s*z\.string\(\)/);
  });

  it('creates a collection with correct path + inferred array schema', async () => {
    const result = await scaffoldContent(contentDir, {
      kind: 'collection',
      name: 'products',
      content: [{ id: 'a', price: 10 }],
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.file).toBe(path.join(contentDir, 'data/products.json'));
    expect(result.importLine).toBe(`import { products } from 'virtual:content';`);
    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    expect(schemasSource).toMatch(/products:\s*z\.array/);
  });

  it('creates the site singleton (kind=site, name ignored)', async () => {
    const result = await scaffoldContent(contentDir, {
      kind: 'site',
      content: { brand: 'Acme' },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.file).toBe(path.join(contentDir, 'site.json'));
    expect(result.key).toBe('site');
  });

  it('patches an existing schemas.ts in place (does not overwrite other keys)', async () => {
    // First scaffold
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Hi' } },
    });
    // Second scaffold — should append to existing schemas
    const second = await scaffoldContent(contentDir, {
      kind: 'collection',
      name: 'products',
      content: [{ id: 'a' }],
    });
    if (!second.ok) throw new Error('expected ok');
    expect(second.schemasCreated).toBe(false);

    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    expect(schemasSource).toMatch(/home:\s*z\.object/);
    expect(schemasSource).toMatch(/products:\s*z\.array/);
  });

  it('is idempotent: re-scaffolding the same name updates the entry, does not duplicate', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { title: 'V1' },
    });
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { title: 'V2', body: 'new field' },
    });

    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    // Exactly one `home:` entry
    const matches = schemasSource.match(/home:\s*z\./g) ?? [];
    expect(matches).toHaveLength(1);

    const content = JSON.parse(
      await fs.readFile(path.join(contentDir, 'pages/home.json'), 'utf8'),
    );
    expect(content).toEqual({ title: 'V2', body: 'new field' });
  });

  it('rejects an invalid name with a structured error', async () => {
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'My Page',
      content: { title: 'x' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-name' } });
  });

  it('rejects content containing null with a structured error', async () => {
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { title: null },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'cannot-infer-schema' } });
  });

  it('returns schemas-shape-unsupported when schemas.ts has an unsupported shape', async () => {
    // Pre-populate schemas.ts with a non-object-literal export
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(
      path.join(contentDir, 'schemas.ts'),
      `import { z } from 'zod';\nexport const schemas = getSchemas();\n`,
      'utf8',
    );
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { title: 'x' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'schemas-shape-unsupported' } });
  });

  it('mints ids on scaffolded collection items', async () => {
    const dir = await mkTempContent();
    const res = await scaffoldContent(dir, {
      kind: 'page',
      name: 'home',
      content: { menu: [{ name: 'Soup' }, { name: 'Salad' }] },
    });
    expect(res.ok).toBe(true);
    const written = JSON.parse(await fs.readFile(path.join(dir, 'pages', 'home.json'), 'utf8'));
    expect(typeof written.menu[0].id).toBe('string');
    expect(written.menu[0].id).not.toBe(written.menu[1].id);
    expect(written.menu[0].name).toBe('Soup');
    expect(written.menu[1].name).toBe('Salad');
  });
});

describe('readUserLocks', () => {
  let contentDir: string;

  beforeEach(async () => { contentDir = await mkTempContent(); await fs.mkdir(contentDir, { recursive: true }); });
  afterEach(async () => {
    await fs.rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  it('returns [] when the lock file is absent', async () => {
    expect(await readUserLocks(contentDir)).toEqual([]);
  });

  it('returns lockedKeys when present and well-formed', async () => {
    await fs.writeFile(
      path.join(contentDir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: ['home.hero.title', 'menu.dishes[0].price'] }),
      'utf8',
    );
    expect(await readUserLocks(contentDir)).toEqual(['home.hero.title', 'menu.dishes[0].price']);
  });

  it('returns [] on malformed JSON', async () => {
    await fs.writeFile(path.join(contentDir, '.user-edits.json'), '{ not json', 'utf8');
    expect(await readUserLocks(contentDir)).toEqual([]);
  });

  it('returns [] when shape is an empty object (no lockedKeys)', async () => {
    await fs.writeFile(path.join(contentDir, '.user-edits.json'), '{}', 'utf8');
    expect(await readUserLocks(contentDir)).toEqual([]);
  });

  it('returns [] when the top-level value is an array', async () => {
    await fs.writeFile(path.join(contentDir, '.user-edits.json'), '["home.hero.title"]', 'utf8');
    expect(await readUserLocks(contentDir)).toEqual([]);
  });

  it('returns [] when the top-level value is a number', async () => {
    await fs.writeFile(path.join(contentDir, '.user-edits.json'), '42', 'utf8');
    expect(await readUserLocks(contentDir)).toEqual([]);
  });

  it('filters out non-string entries from lockedKeys', async () => {
    await fs.writeFile(
      path.join(contentDir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: ['home.hero.title', 7, null, { x: 1 }] }),
      'utf8',
    );
    expect(await readUserLocks(contentDir)).toEqual(['home.hero.title']);
  });
});

describe('applyLocks', () => {
  it('preserves a locked leaf and takes incoming for unlocked siblings', () => {
    const existing = { hero: { title: 'User Title', subtitle: 'Old Sub' } };
    const incoming = { hero: { title: 'Agent Title', subtitle: 'New Sub' } };
    const result = applyLocks(existing, incoming, ['home.hero.title'], 'home');
    expect(result).toEqual({ hero: { title: 'User Title', subtitle: 'New Sub' } });
  });

  it('does not mutate the incoming object', () => {
    const incoming = { hero: { title: 'Agent Title' } };
    applyLocks({ hero: { title: 'User Title' } }, incoming, ['home.hero.title'], 'home');
    expect(incoming).toEqual({ hero: { title: 'Agent Title' } });
  });

  it('ignores locks whose root segment does not match', () => {
    const existing = { hero: { title: 'User Title' } };
    const incoming = { hero: { title: 'Agent Title' } };
    const result = applyLocks(existing, incoming, ['menu.hero.title'], 'home');
    expect(result).toEqual({ hero: { title: 'Agent Title' } });
  });

  it('preserves array-index locked paths', () => {
    const existing = { dishes: [{ name: 'Pizza', price: 12 }, { name: 'Pasta', price: 9 }] };
    const incoming = { dishes: [{ name: 'Pizza', price: 15 }, { name: 'Pasta', price: 11 }] };
    const result = applyLocks(existing, incoming, ['menu.dishes[0].price'], 'menu');
    expect(result).toEqual({ dishes: [{ name: 'Pizza', price: 12 }, { name: 'Pasta', price: 11 }] });
  });

  it('drops a lock silently when incoming no longer has the path (restructure)', () => {
    const existing = { hero: { title: 'User Title' } };
    const incoming = { banner: { heading: 'Agent Heading' } };
    const result = applyLocks(existing, incoming, ['home.hero.title'], 'home');
    expect(result).toEqual({ banner: { heading: 'Agent Heading' } });
  });

  it('drops a lock silently when existing lacks the path', () => {
    const existing = { hero: {} };
    const incoming = { hero: { title: 'Agent Title' } };
    const result = applyLocks(existing, incoming, ['home.hero.title'], 'home');
    expect(result).toEqual({ hero: { title: 'Agent Title' } });
  });

  it('handles a root-level lock with an empty path (whole root)', () => {
    const result = applyLocks({ a: 1 }, { a: 2 }, ['home'], 'home');
    // Lock with no sub-path is moot — applyLocks only overrides leaf paths.
    expect(result).toEqual({ a: 2 });
  });
});

describe('validateCollectionIds', () => {
  it('returns [] when every item has a unique id', () => {
    expect(validateCollectionIds({ items: [{ id: 'a' }, { id: 'b' }] })).toEqual([]);
  });

  it('flags an item missing an id', () => {
    const issues = validateCollectionIds({ items: [{ id: 'a' }, { name: 'x' }] });
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/missing/i);
  });

  it('flags duplicate ids in the same array', () => {
    const issues = validateCollectionIds({ items: [{ id: 'a' }, { id: 'a' }] });
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/duplicate/i);
  });
});

describe('ensureCollectionIds', () => {
  it('mints ids for id-less array-of-object elements', () => {
    const content = { items: [{ name: 'a' }, { name: 'b' }] };
    ensureCollectionIds(content);
    expect(typeof content.items[0].id).toBe('string');
    expect(content.items[0].id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(content.items[0].id).not.toBe(content.items[1].id);
  });

  it('preserves existing ids', () => {
    const content = { items: [{ id: 'keep', name: 'a' }] };
    ensureCollectionIds(content);
    expect(content.items[0].id).toBe('keep');
  });

  it('is idempotent', () => {
    const content = { items: [{ name: 'a' }] };
    ensureCollectionIds(content);
    const first = content.items[0].id;
    ensureCollectionIds(content);
    expect(content.items[0].id).toBe(first);
  });

  it('recurses into nested collections', () => {
    const content = { cats: [{ name: 'x', items: [{ name: 'y' }] }] };
    ensureCollectionIds(content);
    expect(typeof content.cats[0].id).toBe('string');
    expect(typeof content.cats[0].items[0].id).toBe('string');
  });

  it('leaves non-array-element objects alone', () => {
    const content = { hero: { title: 'hi' } };
    ensureCollectionIds(content);
    expect('id' in content.hero).toBe(false);
  });

  it('leaves primitive arrays alone', () => {
    const content = { tags: ['a', 'b'] };
    ensureCollectionIds(content);
    expect(content.tags).toEqual(['a', 'b']);
  });
});

describe('scaffoldContent (replace-except-user-locked)', () => {
  let contentDir: string;

  beforeEach(async () => { contentDir = await mkTempContent(); });
  afterEach(async () => {
    await fs.rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  async function writeLocks(keys: string[]): Promise<void> {
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(
      path.join(contentDir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: keys }),
      'utf8',
    );
  }

  it('preserves a locked leaf, takes incoming for unlocked siblings on re-scaffold', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Original', subtitle: 'Original Sub' } },
    });
    await writeLocks(['home.hero.title']);

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Agent Rewrite', subtitle: 'Agent Sub' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ hero: { title: 'Original', subtitle: 'Agent Sub' } });
  });

  it('preserves locked leaf + adds a new incoming field, and registers it in the schema', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Original' } },
    });
    await writeLocks(['home.hero.title']);

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Agent Rewrite', cta: 'Buy now' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ hero: { title: 'Original', cta: 'Buy now' } });

    const schemasSource = await fs.readFile(path.join(contentDir, 'schemas.ts'), 'utf8');
    expect(schemasSource).toMatch(/"cta":\s*z\.string\(\)/);
    expect(schemasSource).toMatch(/"title":\s*z\.string\(\)/);
  });

  it('does a full replace when no locks exist (incoming wins)', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Original', subtitle: 'Original Sub' } },
    });
    // No .user-edits.json written.

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Agent Rewrite', subtitle: 'Agent Sub' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ hero: { title: 'Agent Rewrite', subtitle: 'Agent Sub' } });
  });

  it('ignores locks when mode is "replace" (incoming wins)', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Original' } },
    });
    await writeLocks(['home.hero.title']);

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      mode: 'replace',
      content: { hero: { title: 'Agent Rewrite' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ hero: { title: 'Agent Rewrite' } });
  });

  it('drops the lock silently when incoming restructures away the locked path', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Original' } },
    });
    await writeLocks(['home.hero.title']);

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { banner: { heading: 'Agent Heading' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ banner: { heading: 'Agent Heading' } });
  });

  it('preserves a nested lock when agent re-scaffolds with same item ids (rekey upgrades positional → id-anchored)', async () => {
    const firstResult = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ name: 'Pizza', price: 12 }, { name: 'Pasta', price: 9 }] },
    });
    if (!firstResult.ok) throw new Error('expected ok');
    // Read back the minted ids so second scaffold can carry them (realistic agent behaviour)
    const firstContent = JSON.parse(await fs.readFile(firstResult.file, 'utf8'));
    const pizzaId: string = firstContent.dishes[0].id;
    const pastaId: string = firstContent.dishes[1].id;
    await writeLocks(['menu.dishes[0].price']);

    // Agent re-scaffolds preserving the existing ids (so rekey can track them)
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ id: pizzaId, name: 'Pizza', price: 20 }, { id: pastaId, name: 'Pasta', price: 11 }] },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    // positional lock was upgraded to [@pizzaId].price; that id exists in incoming → locked price preserved
    expect(content).toMatchObject({ dishes: [{ name: 'Pizza', price: 12 }, { name: 'Pasta', price: 11 }] });
  });

  it('a locked edit follows its item by id across an INSERT (headline behavior; agent gives every item a stable id)', async () => {
    // The headline S4 guarantee, previously live-verify only: a user's locked
    // edit stays on its item when the list grows. This is the realistic /
    // prompt-enforced shape the live-verify exercised — the agent re-scaffolds
    // giving EVERY item a stable id (echoing existing ones, fresh for the new
    // one). NOTE: an id-LESS re-scaffold that inserts would NOT survive — the
    // by-position inheritExistingIds (see its INVARIANT) would let the inserted
    // item adopt the moved item's id and migrate the lock. That boundary is the
    // reason the agent is prompted to echo ids; S4b/c will reconcile by id.
    const first = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ name: 'Pizza', price: 12 }] },
    });
    if (!first.ok) throw new Error('expected ok');
    const pizzaId: string = JSON.parse(await fs.readFile(first.file, 'utf8')).dishes[0].id;
    await writeLocks(['menu.dishes[0].price']);

    // Agent re-scaffolds: Soup inserted at the front (its own fresh id), Pizza
    // echoes its existing id and is now at index 1, regenerated price 20.
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ id: 'soup-1', name: 'Soup', price: 5 }, { id: pizzaId, name: 'Pizza', price: 20 }] },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content.dishes[0].name).toBe('Soup'); // inserted item, untouched
    expect(content.dishes[1].name).toBe('Pizza');
    expect(content.dishes[1].price).toBe(12); // lock followed Pizza by id to its NEW slot, not slot 0
  });

  it('fails safe (read-failed) without overwriting when reading user locks throws on an existing file', async () => {
    await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'User Title' } },
    });
    const before = await fs.readFile(path.join(contentDir, 'pages/home.json'), 'utf8');

    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const spy = vi.spyOn(contentUserEdits, 'readUserLocks').mockRejectedValueOnce(eacces);
    try {
      const result = await scaffoldContent(contentDir, {
        kind: 'page',
        name: 'home',
        content: { hero: { title: 'Agent Rewrite' } },
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'read-failed' } });
    } finally {
      spy.mockRestore();
    }

    // The pre-existing content must be untouched — no silent overwrite.
    const after = await fs.readFile(path.join(contentDir, 'pages/home.json'), 'utf8');
    expect(after).toBe(before);
  });

  it('does a full replace (no merge) when there is no existing file even with locks present', async () => {
    await writeLocks(['home.hero.title']);

    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'home',
      content: { hero: { title: 'Agent Title' } },
    });
    if (!result.ok) throw new Error('expected ok');

    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    expect(content).toEqual({ hero: { title: 'Agent Title' } });
  });
});

describe('applyLocks id-anchored keys', () => {
  it('preserves a user value by item id across a reorder', () => {
    const existing = { items: [{ id: 'a', price: '9' }, { id: 'b', price: '2' }] };
    // incoming has the SAME items in a DIFFERENT order with default prices
    const incoming = { items: [{ id: 'b', price: '2' }, { id: 'a', price: '1' }] };
    const result = applyLocks(existing, incoming, ['root.items[@a].price'], 'root') as typeof existing;
    const a = result.items.find((i) => i.id === 'a')!;
    expect(a.price).toBe('9'); // followed the id, not the position
  });

  it('drops an id-anchored lock whose id is gone', () => {
    const existing = { items: [{ id: 'a', price: '9' }] };
    const incoming = { items: [{ id: 'b', price: '1' }] };
    const result = applyLocks(existing, incoming, ['root.items[@a].price'], 'root') as typeof existing;
    expect(result.items[0].price).toBe('1'); // lock dropped, default kept
  });

  it('still honors positional locks', () => {
    const existing = { items: [{ price: '9' }] };
    const incoming = { items: [{ price: '1' }] };
    const result = applyLocks(existing, incoming, ['root.items[0].price'], 'root') as typeof existing;
    expect(result.items[0].price).toBe('9');
  });
});

describe('rekeyPositionalLocks', () => {
  it('rewrites a positional lock to id-anchored using existing ids', () => {
    const existing = { items: [{ id: 'a', price: '1' }, { id: 'b', price: '2' }] };
    const out = rekeyPositionalLocks(existing, ['root.items[1].price'], 'root');
    expect(out).toEqual(['root.items[@b].price']);
  });
  it('leaves a lock positional when the element has no id', () => {
    const existing = { items: [{ price: '1' }] };
    const out = rekeyPositionalLocks(existing, ['root.items[0].price'], 'root');
    expect(out).toEqual(['root.items[0].price']);
  });
  it('passes through locks for other roots untouched', () => {
    const existing = { items: [{ id: 'a' }] };
    const out = rekeyPositionalLocks(existing, ['other.x[0].y'], 'root');
    expect(out).toEqual(['other.x[0].y']);
  });
  it('leaves already id-anchored locks unchanged', () => {
    const existing = { items: [{ id: 'a', price: '1' }] };
    const out = rekeyPositionalLocks(existing, ['root.items[@a].price'], 'root');
    expect(out).toEqual(['root.items[@a].price']);
  });
  it('rewrites both segments of a two-level nested positional lock (the depth the feature targets)', () => {
    // Mirrors the live-verify shape categories[@..].items[@..]: rekey walks
    // getAtPath per intermediate segment, so a wrong container lookup would
    // silently leave a segment positional. This pins that both levels resolve.
    const existing = {
      categories: [{ id: 'cat', items: [{ id: 'x', price: '1' }, { id: 'y', price: '2' }] }],
    };
    const out = rekeyPositionalLocks(existing, ['root.categories[0].items[1].price'], 'root');
    expect(out).toEqual(['root.categories[@cat].items[@y].price']);
  });
  it('rekeys the outer segment but leaves an id-less inner element positional', () => {
    const existing = { categories: [{ id: 'cat', items: [{ price: '1' }] }] };
    const out = rekeyPositionalLocks(existing, ['root.categories[0].items[0].price'], 'root');
    expect(out).toEqual(['root.categories[@cat].items[0].price']);
  });
});

describe('inheritExistingIds', () => {
  it('id-less incoming item adopts existing id at same position', () => {
    const existing = { dishes: [{ id: 'A', name: 'Pizza' }, { id: 'B', name: 'Pasta' }] };
    const incoming = { dishes: [{ name: 'Pizza' }, { name: 'Pasta' }] };
    inheritExistingIds(existing, incoming);
    expect(incoming.dishes[0].id).toBe('A');
    expect(incoming.dishes[1].id).toBe('B');
  });
  it('leaves incoming id intact when it already has one', () => {
    const existing = { dishes: [{ id: 'A', name: 'Pizza' }] };
    const incoming = { dishes: [{ id: 'keep', name: 'Pizza' }] };
    inheritExistingIds(existing, incoming);
    expect(incoming.dishes[0].id).toBe('keep');
  });
  it('does not mint for new positions beyond existing length', () => {
    const existing = { dishes: [{ id: 'A', name: 'Pizza' }] };
    const incoming = { dishes: [{ name: 'Pizza' }, { name: 'New' }] };
    inheritExistingIds(existing, incoming);
    expect(incoming.dishes[0].id).toBe('A');
    expect('id' in incoming.dishes[1]).toBe(false); // ensureCollectionIds mints this later
  });
  it('recurses into nested collections', () => {
    const existing = { menu: [{ id: 'C', items: [{ id: 'D', n: 1 }] }] };
    const incoming = { menu: [{ items: [{ n: 1 }] }] };
    inheritExistingIds(existing, incoming);
    expect(incoming.menu[0].id).toBe('C');
    expect(incoming.menu[0].items[0].id).toBe('D');
  });
});

describe('scaffoldContent (id-less re-scaffold preserves locked edits)', () => {
  let contentDir: string;

  beforeEach(async () => { contentDir = await mkTempContent(); });
  afterEach(async () => {
    await fs.rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  async function writeLocks(keys: string[]): Promise<void> {
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(
      path.join(contentDir, '.user-edits.json'),
      JSON.stringify({ lockedKeys: keys }),
      'utf8',
    );
  }

  it('preserves a collection-item edit across an id-less agent re-scaffold', async () => {
    // First scaffold: mints ids on disk
    const firstResult = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ name: 'Pizza', price: 12 }] },
    });
    if (!firstResult.ok) throw new Error('expected ok');
    // Lock the price at position 0 (positional lock — will be rekeyed to [@id].price)
    await writeLocks(['menu.dishes[0].price']);

    // Agent re-scaffolds WITHOUT ids (the regression case: fresh ids minted → lock miss)
    const result = await scaffoldContent(contentDir, {
      kind: 'page',
      name: 'menu',
      content: { dishes: [{ name: 'Pizza', price: 99 }] }, // id-less, price changed
    });
    if (!result.ok) throw new Error('expected ok');
    const content = JSON.parse(await fs.readFile(result.file, 'utf8'));
    // user edit (price=12) must survive even though agent sent price=99 without ids
    expect(content.dishes[0].price).toBe(12);
  });
});
