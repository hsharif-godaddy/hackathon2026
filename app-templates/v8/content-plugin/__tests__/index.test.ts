import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Plugin } from 'vite';
import { contentPlugin, validateContentEager } from '../src/index';
import { z } from 'zod';

describe('content-plugin inert safety', () => {
  function makeServer(getModuleById: () => unknown = () => undefined) {
    const watcherAdd = vi.fn();
    const handlers: Record<string, (file: string) => void> = {};
    const on = vi.fn((event: string, cb: (file: string) => void) => {
      handlers[event] = cb;
    });
    const reloadModule = vi.fn(async () => {});
    const server = {
      watcher: { add: watcherAdd, on },
      moduleGraph: { getModuleById },
      config: { logger: { info: vi.fn(), error: vi.fn() } },
      reloadModule,
      ws: { send: vi.fn() },
    };
    return { server, watcherAdd, on, handlers, reloadModule };
  }

  it('does NOT call watcher.add when contentDir is absent', () => {
    const plugin = contentPlugin({ contentDir: 'src/content' });
    // @ts-expect-error minimal config stub
    plugin.configResolved?.({ root: '/tmp/nonexistent-app-root-xyz-absent' });
    const { server, watcherAdd } = makeServer();
    // @ts-expect-error minimal server stub
    plugin.configureServer?.(server);
    expect(watcherAdd).not.toHaveBeenCalled();
  });

  it('arms reload handlers even when contentDir is absent at boot, so late-created content hot-reloads', () => {
    const plugin = contentPlugin({ contentDir: 'src/content' });
    const root = '/tmp/nonexistent-app-root-xyz-late';
    // @ts-expect-error minimal config stub
    plugin.configResolved?.({ root });
    // Virtual module is already in the graph (page imported it before content existed).
    const getModuleById = vi.fn(() => ({}));
    const { server, on, handlers, reloadModule } = makeServer(getModuleById);
    // @ts-expect-error minimal server stub
    plugin.configureServer?.(server);

    // Handlers must be registered despite no src/content at boot.
    expect(on).toHaveBeenCalledWith('change', expect.any(Function));
    expect(on).toHaveBeenCalledWith('add', expect.any(Function));

    // A content file created later under contentDir triggers a reload.
    handlers.add?.(path.join(root, 'src/content/data/recipes.json'));
    expect(getModuleById).toHaveBeenCalled();
    expect(reloadModule).toHaveBeenCalled();
  });

  it('DOES call watcher.add when contentDir exists', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airo-inert-'));
    try {
      const contentDir = path.join(tmpRoot, 'src/content');
      await fs.mkdir(contentDir, { recursive: true });
      await fs.writeFile(path.join(contentDir, 'site.json'), '{}', 'utf8');

      const plugin = contentPlugin({ contentDir: 'src/content' });
      // @ts-expect-error minimal config stub
      plugin.configResolved?.({ root: tmpRoot });
      const { server, watcherAdd } = makeServer();
      // @ts-expect-error minimal server stub
      plugin.configureServer?.(server);
      expect(watcherAdd).toHaveBeenCalledWith(contentDir);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

const VIRTUAL_ID = 'virtual:content';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

async function mkTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'airo-content-'));
}

async function writeFile(p: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, contents, 'utf8');
}

async function initPlugin(root: string): Promise<Plugin> {
  const plugin = contentPlugin();
  const config = { root } as any;
  if (typeof plugin.configResolved === 'function') {
    await (plugin.configResolved as any).call(plugin, config);
  }
  return plugin;
}

async function loadVirtual(plugin: Plugin): Promise<string> {
  const resolved = await (plugin.resolveId as any).call(plugin, VIRTUAL_ID);
  expect(resolved).toBe(RESOLVED_VIRTUAL_ID);
  const loaded = await (plugin.load as any).call(plugin, RESOLVED_VIRTUAL_ID);
  expect(typeof loaded).toBe('string');
  return loaded as string;
}

describe('contentPlugin', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkTempRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves the virtual module id', async () => {
    const plugin = await initPlugin(root);
    const resolved = await (plugin.resolveId as any).call(plugin, VIRTUAL_ID);
    expect(resolved).toBe(RESOLVED_VIRTUAL_ID);
    const unresolved = await (plugin.resolveId as any).call(plugin, 'some-other-id');
    expect(unresolved).toBeUndefined();
  });

  it('emits an empty module when no content exists', async () => {
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code.trim()).toBe('');
  });

  it('discovers site.json and emits a typed export', async () => {
    await writeFile(
      path.join(root, 'src/content/site.json'),
      `{"brand":"Acme"}`,
    );
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code).toContain('export const site =');
    expect(code).toContain('"brand": "Acme"');
  });

  it('discovers pages and data in parallel', async () => {
    await writeFile(
      path.join(root, 'src/content/pages/home.json'),
      `{"hero":{"title":"Hello"}}`,
    );
    await writeFile(
      path.join(root, 'src/content/data/products.json'),
      `[{"id":"a","name":"A"}]`,
    );
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code).toContain('export const home =');
    expect(code).toContain('"title": "Hello"');
    expect(code).toContain('export const products =');
    expect(code).toContain('"id": "a"');
  });

  it('validates through schemas when schemas.ts exists', async () => {
    await writeFile(path.join(root, 'src/content/schemas.ts'), `export const schemas = {};`);
    await writeFile(
      path.join(root, 'src/content/site.json'),
      `{"brand":"Acme"}`,
    );
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code).toContain(`import { schemas } from '/src/content/schemas';`);
    expect(code).toContain('schemas.site ?? identity');
  });

  it('skips validation wrapping when schemas.ts is absent', async () => {
    await writeFile(
      path.join(root, 'src/content/site.json'),
      `{"brand":"Acme"}`,
    );
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code).not.toContain('schemas.site');
    expect(code).not.toContain('identity');
  });

  it('rejects invalid content keys (non-identifier filenames)', async () => {
    await writeFile(
      path.join(root, 'src/content/pages/not valid.json'),
      `{}`,
    );
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(/invalid content key/);
  });

  it('rejects content keys that are JS reserved words', async () => {
    await writeFile(
      path.join(root, 'src/content/pages/export.json'),
      `{}`,
    );
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(/reserved content key "export"/);
  });

  it('rejects other JS reserved words (default, class, import)', async () => {
    for (const word of ['default', 'class', 'import']) {
      const r = await mkTempRoot();
      try {
        await writeFile(path.join(r, `src/content/data/${word}.json`), `{}`);
        const p = await initPlugin(r);
        await expect(loadVirtual(p)).rejects.toThrow(new RegExp(`reserved content key "${word}"`));
      } finally {
        await fs.rm(r, { recursive: true, force: true });
      }
    }
  });

  it('rejects collisions between pages/<key>.json and data/<key>.json', async () => {
    await writeFile(path.join(root, 'src/content/pages/dup.json'), `{}`);
    await writeFile(path.join(root, 'src/content/data/dup.json'), `{}`);
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(/duplicate content key/);
  });

  it('surfaces malformed JSON as a parse error', async () => {
    await writeFile(
      path.join(root, 'src/content/data/products.json'),
      `{not json}`,
    );
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(/failed to parse/);
  });

  it('has enforce: "pre" so resolveId runs before Vite core plugins', async () => {
    const plugin = await initPlugin(root);
    expect(plugin.enforce).toBe('pre');
  });
});

describe('contentPlugin — resolveId block for direct JSON imports', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkTempRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function callResolveId(
    plugin: Plugin,
    source: string,
    importer?: string,
  ): Promise<string | null | undefined> {
    return (plugin.resolveId as any).call(plugin, source, importer);
  }

  it('throws on an alias-resolved absolute path under src/content/', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/home.json');
    await expect(callResolveId(plugin, abs)).rejects.toThrow(
      /Direct import of .*home\.json is forbidden/,
    );
  });

  it('does NOT throw for the schemas module — the eager validator loads it via ssrLoadModule("/src/content/schemas")', async () => {
    const plugin = await initPlugin(root);
    // Extensionless, project-root-relative — exactly how validateContentEager
    // resolves it. Must pass through (load() then handles schemas.ts).
    await expect(callResolveId(plugin, '/src/content/schemas')).resolves.toBeUndefined();
  });

  it('does NOT throw for an absolute schemas.ts path', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/schemas.ts');
    await expect(callResolveId(plugin, abs)).resolves.toBeUndefined();
  });

  it('does NOT throw for virtual-content.d.ts under src/content (type-only, never a runtime import)', async () => {
    const plugin = await initPlugin(root);
    // content_scaffold emits this .d.ts INTO src/content/ (#5338); the guard
    // must let it pass — a type-declaration file is never a content-data import.
    await expect(callResolveId(plugin, '/src/content/virtual-content.d.ts')).resolves.toBeUndefined();
    const abs = path.join(root, 'src/content/virtual-content.d.ts');
    await expect(callResolveId(plugin, abs)).resolves.toBeUndefined();
  });

  it('still throws for a non-.d.ts, non-schemas file under src/content (e.g. a stray .ts)', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/helpers.ts');
    await expect(callResolveId(plugin, abs)).rejects.toThrow(/forbidden/);
  });

  it('throws on a relative import from a page that resolves under src/content/', async () => {
    const plugin = await initPlugin(root);
    const importer = path.join(root, 'src/pages/index.tsx');
    // From src/pages/ go up one to src/ then into content/
    await expect(
      callResolveId(plugin, '../content/home.json', importer),
    ).rejects.toThrow(/Direct import of .*home\.json is forbidden/);
  });

  it('throws on a project-root-relative import (/src/content/...)', async () => {
    const plugin = await initPlugin(root);
    await expect(
      callResolveId(plugin, '/src/content/pages/home.json'),
    ).rejects.toThrow(/forbidden/);
  });

  it('blocks imports with ?raw query suffix', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/site.json?raw');
    await expect(callResolveId(plugin, abs)).rejects.toThrow(/forbidden/);
  });

  it('blocks imports with ?url query suffix', async () => {
    const plugin = await initPlugin(root);
    const importer = path.join(root, 'src/pages/index.tsx');
    await expect(
      callResolveId(plugin, '../content/home.json?url', importer),
    ).rejects.toThrow(/forbidden/);
  });

  it('error message points at virtual:content as the correct pattern', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/site.json');
    await expect(callResolveId(plugin, abs)).rejects.toThrow(/virtual:content/);
  });

  it('still resolves virtual:content imports', async () => {
    const plugin = await initPlugin(root);
    const resolved = await callResolveId(plugin, 'virtual:content');
    expect(resolved).toBe(RESOLVED_VIRTUAL_ID);
  });

  it('does NOT block the virtual module\'s own schemas.ts import', async () => {
    const plugin = await initPlugin(root);
    const resolved = await callResolveId(plugin, '/src/content/schemas', RESOLVED_VIRTUAL_ID);
    expect(resolved).toBeUndefined();
  });

  it('blocks a .ts barrel file via relative import (non-JSON content bypass)', async () => {
    const plugin = await initPlugin(root);
    const importer = path.join(root, 'src/pages/index.tsx');
    await expect(
      callResolveId(plugin, '../content/index', importer),
    ).rejects.toThrow(/forbidden/);
  });

  it('blocks a .ts file via absolute path under src/content/', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/content/index.ts');
    await expect(callResolveId(plugin, abs)).rejects.toThrow(/forbidden/);
  });

  it('error message for non-JSON block points at virtual:content', async () => {
    const plugin = await initPlugin(root);
    const importer = path.join(root, 'src/pages/index.tsx');
    await expect(
      callResolveId(plugin, '../content/index', importer),
    ).rejects.toThrow(/virtual:content/);
  });

  it('does NOT block .json files outside src/content/', async () => {
    const plugin = await initPlugin(root);
    const abs = path.join(root, 'src/other/data.json');
    const resolved = await callResolveId(plugin, abs);
    expect(resolved).toBeUndefined();
  });

  it('does NOT block non-JSON sources', async () => {
    const plugin = await initPlugin(root);
    const resolved = await callResolveId(plugin, './some-component');
    expect(resolved).toBeUndefined();
  });

  it('does NOT block bare-specifier imports (node_modules packages)', async () => {
    const plugin = await initPlugin(root);
    const resolved = await callResolveId(plugin, 'some-pkg/content.json');
    expect(resolved).toBeUndefined();
  });
});

describe('contentPlugin — load hook guard for alias-resolved imports', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkTempRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function callLoad(plugin: Plugin, id: string): Promise<string | null | undefined> {
    return (plugin.load as any).call(plugin, id);
  }

  it('blocks a resolved path under src/content/ that is not schemas.ts', async () => {
    const plugin = await initPlugin(root);
    const id = path.join(root, 'src/content/index.ts');
    await expect(callLoad(plugin, id)).rejects.toThrow(/forbidden/);
  });

  it('blocks a resolved path to a subdirectory file under src/content/', async () => {
    const plugin = await initPlugin(root);
    const id = path.join(root, 'src/content/helpers/utils.ts');
    await expect(callLoad(plugin, id)).rejects.toThrow(/forbidden/);
  });

  it('error message points at virtual:content', async () => {
    const plugin = await initPlugin(root);
    const id = path.join(root, 'src/content/index.ts');
    await expect(callLoad(plugin, id)).rejects.toThrow(/virtual:content/);
  });

  it('allows schemas.ts (imported by the virtual module)', async () => {
    const plugin = await initPlugin(root);
    const id = path.join(root, 'src/content/schemas.ts');
    const result = await callLoad(plugin, id);
    expect(result).toBeUndefined();
  });

  it('blocks a nested schemas.ts that is not the top-level schemas file', async () => {
    const plugin = await initPlugin(root);
    // pages/schemas.ts is NOT the real schemas file — must still be blocked
    const id = path.join(root, 'src/content/pages/schemas.ts');
    await expect(callLoad(plugin, id)).rejects.toThrow(/forbidden/);
  });

  it('allows the virtual module itself', async () => {
    await writeFile(path.join(root, 'src/content/site.json'), '{"brand":"x"}');
    const plugin = await initPlugin(root);
    const result = await callLoad(plugin, RESOLVED_VIRTUAL_ID);
    expect(typeof result).toBe('string');
  });

  it('does NOT block files outside src/content/', async () => {
    const plugin = await initPlugin(root);
    const id = path.join(root, 'src/pages/index.tsx');
    const result = await callLoad(plugin, id);
    expect(result).toBeUndefined();
  });
});

describe('contentPlugin — layout validator', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkTempRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('throws when a JSON file sits directly at src/content/ (other than site.json)', async () => {
    await writeFile(path.join(root, 'src/content/home.json'), `{}`);
    await writeFile(path.join(root, 'src/content/pages/.keep'), '');
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(
      /Unexpected file src\/content\/home\.json/,
    );
  });

  it('error message names the correct pages/ and data/ subdirectories', async () => {
    await writeFile(path.join(root, 'src/content/home.json'), `{}`);
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(
      /src\/content\/pages\/home\.json[\s\S]*src\/content\/data\/home\.json/,
    );
  });

  it('accepts the canonical layout (site.json + pages/ + data/)', async () => {
    await writeFile(path.join(root, 'src/content/site.json'), `{"brand":"x"}`);
    await writeFile(path.join(root, 'src/content/pages/home.json'), `{"hero":{}}`);
    await writeFile(path.join(root, 'src/content/data/products.json'), `[]`);
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    expect(code).toContain('export const site =');
    expect(code).toContain('export const home =');
    expect(code).toContain('export const products =');
  });

  it('ignores non-JSON files at the top level (they are outside our enforcement scope)', async () => {
    await writeFile(path.join(root, 'src/content/site.json'), `{}`);
    await writeFile(path.join(root, 'src/content/README.md'), `# content`);
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).resolves.toBeTruthy();
  });

  it('ignores subdirectories at the top level (they are our layout, not violations)', async () => {
    await writeFile(path.join(root, 'src/content/pages/home.json'), `{}`);
    await writeFile(path.join(root, 'src/content/data/products.json'), `[]`);
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).resolves.toBeTruthy();
  });

  it('ignores a top-level .user-edits.json dotfile (CMS provenance sidecar, not content)', async () => {
    await writeFile(path.join(root, 'src/content/site.json'), `{"brand":"x"}`);
    await writeFile(
      path.join(root, 'src/content/.user-edits.json'),
      JSON.stringify({ lockedKeys: ['site.brand'] }),
    );
    const plugin = await initPlugin(root);
    const code = await loadVirtual(plugin);
    // No throw, and the dotfile is not emitted as a content export.
    expect(code).toContain('export const site =');
    expect(code).not.toContain('export const .user-edits');
    expect(code).not.toContain('user-edits');
  });

  it('still throws on a genuine stray top-level JSON file (home.json) even with a dotfile present', async () => {
    await writeFile(path.join(root, 'src/content/.user-edits.json'), `{"lockedKeys":[]}`);
    await writeFile(path.join(root, 'src/content/home.json'), `{}`);
    const plugin = await initPlugin(root);
    await expect(loadVirtual(plugin)).rejects.toThrow(
      /Unexpected file src\/content\/home\.json/,
    );
  });
});

describe('validateContentEager', () => {
  let root: string;
  let contentDir: string;
  const schemasImportPath = '/src/content/schemas';

  beforeEach(async () => {
    root = await mkTempRoot();
    contentDir = path.join(root, 'src/content');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const fakeServer = (schemas: Record<string, unknown> | undefined) => ({
    ssrLoadModule: async (_url: string) => ({ schemas }),
  });

  it('returns quietly when schemas.ts is absent (no validation to run)', async () => {
    await writeFile(path.join(contentDir, 'site.json'), `{"brand":"x"}`);
    const server = {
      ssrLoadModule: async () => {
        throw new Error('ssrLoadModule should not be called when schemas.ts is absent');
      },
    };
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).resolves.toBeUndefined();
  });

  it('returns quietly when schemas.ts has no `schemas` export', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `export const other = 1;`);
    await writeFile(path.join(contentDir, 'site.json'), `{"brand":"x"}`);
    const server = fakeServer(undefined);
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).resolves.toBeUndefined();
  });

  it('passes when every content file matches its schema', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `export const schemas = {};`);
    await writeFile(path.join(contentDir, 'site.json'), `{"brand":"Acme"}`);
    await writeFile(path.join(contentDir, 'pages/home.json'), `{"hero":{"title":"Hi"}}`);
    const server = fakeServer({
      site: z.object({ brand: z.string() }),
      home: z.object({ hero: z.object({ title: z.string() }) }),
    });
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).resolves.toBeUndefined();
  });

  it('throws with the file path and the Zod error when content violates its schema', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `export const schemas = {};`);
    await writeFile(path.join(contentDir, 'site.json'), `{"brand": 42}`);
    const server = fakeServer({
      site: z.object({ brand: z.string() }),
    });
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).rejects.toThrow(/site\.json does not match schemas\.site/);
  });

  it('skips content files whose key has no registered schema (pass-through by design)', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `export const schemas = {};`);
    await writeFile(path.join(contentDir, 'site.json'), `{"brand":"x"}`);
    await writeFile(path.join(contentDir, 'data/extras.json'), `["anything"]`);
    const server = fakeServer({
      site: z.object({ brand: z.string() }),
      // `extras` intentionally missing — should be tolerated
    });
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).resolves.toBeUndefined();
  });

  it('surfaces an ssrLoadModule failure with the schemas.ts path', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `broken syntax {{{`);
    const server = {
      ssrLoadModule: async () => {
        throw new Error('syntax error');
      },
    };
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).rejects.toThrow(/failed to evaluate .*schemas\.ts.*syntax error/s);
  });

  it('skips non-Zod schema entries without throwing (guard against non-parse exports)', async () => {
    await writeFile(path.join(contentDir, 'schemas.ts'), `export const schemas = {};`);
    await writeFile(path.join(contentDir, 'site.json'), `{"brand":"x"}`);
    // Pass a plain object without .parse — should not throw "schema.parse is not a function"
    const server = fakeServer({ site: { notASchema: true } as unknown as { parse: (v: unknown) => unknown } });
    await expect(
      validateContentEager(server, contentDir, schemasImportPath),
    ).resolves.toBeUndefined();
  });
});
