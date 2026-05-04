import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  scanApiDir,
  sortRoutes,
  generateEntryApiBlocks,
  regenerateEntryApiRegistrations,
} from '../entry-api-sync.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-api-sync-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  // `tmp` is from fs.mkdtemp (os.tmpdir()) and `rel` is a hardcoded test
  // fixture path. No user input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

describe('scanApiDir', () => {
  it('returns empty array for missing dir', async () => {
    const result = await scanApiDir(path.join(tmp, 'missing'));
    expect(result).toEqual([]);
  });

  it('propagates non-ENOENT readdir errors (e.g. EACCES)', async () => {
    // Pins walk()'s ENOENT-only guard: any other fs error must surface so
    // the regenerated entry.ts doesn't silently drop real API routes.
    await fs.mkdir(path.join(tmp, 'api'));
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const spy = vi.spyOn(fs, 'readdir').mockRejectedValue(err);
    await expect(scanApiDir(path.join(tmp, 'api'))).rejects.toThrow(/permission denied/);
    spy.mockRestore();
  });

  it('swallows ENOENT from fs.stat race (entry deleted between readdir and stat)', async () => {
    // A file listed by readdir can vanish before the subsequent stat call
    // (e.g. during a concurrent sync from another process). The walker must
    // skip it silently rather than crashing the migration.
    await writeFile('api/health/GET.ts', 'export default () => {}');
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    const spy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(err);

    const routes = await scanApiDir(path.join(tmp, 'api'));

    // The first entry encountered raced away; subsequent entries are still
    // walked. An empty result set here is acceptable (the only fixture was
    // the one that raced); what matters is no throw.
    expect(Array.isArray(routes)).toBe(true);
    spy.mockRestore();
  });

  it('propagates non-ENOENT fs.stat errors (e.g. EACCES)', async () => {
    // Symmetric with the readdir guard: EACCES/EIO on stat must surface so
    // a route tree the walker can't read doesn't silently yield a smaller
    // regenerated entry.ts than the real filesystem.
    await writeFile('api/health/GET.ts', 'export default () => {}');
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const spy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(err);

    await expect(scanApiDir(path.join(tmp, 'api'))).rejects.toThrow(/permission denied/);
    spy.mockRestore();
  });

  it('discovers GET / POST / etc in nested folders', async () => {
    await writeFile('api/health/GET.ts', 'export default () => {}');
    await writeFile('api/users/POST.ts', 'export default () => {}');
    await writeFile('api/users/[id]/GET.ts', 'export default () => {}');
    await writeFile('api/readme.md', '# skip');

    const routes = await scanApiDir(path.join(tmp, 'api'));
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /health',
      'post /users',
      'get /users/:id',
    ]);
  });
});

describe('sortRoutes', () => {
  it('places parameterized segments after literals at the same depth', () => {
    const sorted = sortRoutes([
      { method: 'get', path: '/users/:id', importPath: '', methodName: 'GET', relDir: 'users/[id]' },
      { method: 'get', path: '/users/me', importPath: '', methodName: 'GET', relDir: 'users/me' },
    ]);
    expect(sorted.map((r) => r.path)).toEqual(['/users/me', '/users/:id']);
  });
});

describe('generateEntryApiBlocks', () => {
  it('returns empty strings for no routes', () => {
    expect(generateEntryApiBlocks([])).toEqual({ imports: '', registrations: '' });
  });

  it('emits unique identifiers and /api-prefixed registrations', () => {
    const { imports, registrations } = generateEntryApiBlocks([
      { method: 'get', path: '/health', importPath: './api/health/GET', methodName: 'GET', relDir: 'health' },
      { method: 'post', path: '/users', importPath: './api/users/POST', methodName: 'POST', relDir: 'users' },
    ]);
    expect(imports).toContain('import health_get_0 from "./api/health/GET";');
    expect(imports).toContain('import users_post_1 from "./api/users/POST";');
    expect(registrations).toContain('app.get("/api/health", health_get_0);');
    expect(registrations).toContain('app.post("/api/users", users_post_1);');
  });

  it('strips [bracket] notation from relDir when building identifiers', () => {
    // Pins the identifierFor bracket-handling path independently of the
    // scanApiDir filesystem walk, so a regression in the stripping regex
    // would fail here without needing to stage real directories.
    const { imports, registrations } = generateEntryApiBlocks([
      {
        method: 'get',
        path: '/users/:id',
        importPath: './api/users/[id]/GET',
        methodName: 'GET',
        relDir: 'users/[id]',
      },
    ]);
    expect(imports).toContain('import users_id_get_0 from "./api/users/[id]/GET";');
    expect(registrations).toContain('app.get("/api/users/:id", users_id_get_0);');
  });

  it('prefixes identifiers that would otherwise start with a digit', () => {
    // JS identifiers cannot start with 0-9. A route dir like `2026/` would
    // previously emit `import 2026_get_0 from ...`, breaking bundle parse
    // and crashlooping the publish container. Underscore-prefix keeps the
    // generated import valid.
    const { imports, registrations } = generateEntryApiBlocks([
      {
        method: 'get',
        path: '/2026',
        importPath: './api/2026/GET',
        methodName: 'GET',
        relDir: '2026',
      },
    ]);
    expect(imports).toContain('import _2026_get_0 from "./api/2026/GET";');
    expect(registrations).toContain('app.get("/api/2026", _2026_get_0);');
  });
});

describe('regenerateEntryApiRegistrations', () => {
  const bareEntry = `import express from "express";
import healthGet from "./api/health/GET";
const app = express();
app.get("/api/health", healthGet);
export default app;
`;

  it('returns no-entry when src/server/entry.ts is missing', async () => {
    const result = await regenerateEntryApiRegistrations(tmp);
    expect(result.reason).toBe('no-entry');
    expect(result.changed).toBe(false);
  });

  it('returns no-api-dir when api directory is missing', async () => {
    await writeFile('src/server/entry.ts', bareEntry);
    const result = await regenerateEntryApiRegistrations(tmp);
    expect(result.reason).toBe('no-api-dir');
  });

  it('propagates non-ENOENT fs.access errors (e.g. EACCES) instead of treating as not-installed', async () => {
    // Pins the catch narrow: an EACCES on entryPath must not masquerade as
    // "no-entry" (which would silently skip regeneration and drop API routes).
    await writeFile('src/server/entry.ts', bareEntry);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const spy = vi.spyOn(fs, 'access').mockRejectedValue(err);
    await expect(regenerateEntryApiRegistrations(tmp)).rejects.toThrow(/permission denied/);
    spy.mockRestore();
  });

  it('rewrites bare healthGet shape into marked block and picks up new routes', async () => {
    await writeFile('src/server/entry.ts', bareEntry);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    await writeFile('src/server/api/users/POST.ts', 'export default () => {}');

    const result = await regenerateEntryApiRegistrations(tmp);
    expect(result.changed).toBe(true);
    expect(result.routeCount).toBe(2);

    const after = await fs.readFile(path.join(tmp, 'src/server/entry.ts'), 'utf8');
    expect(after).toContain('// <api-imports>');
    expect(after).toContain('// </api-imports>');
    expect(after).toContain('import users_post_1 from "./api/users/POST";');
    expect(after).toContain('app.post("/api/users", users_post_1);');
  });

  it('re-runs idempotently on a previously marked entry.ts', async () => {
    const marked = `import express from "express";
// <api-imports>
import health_get_0 from "./api/health/GET";
// </api-imports>
const app = express();
// <api-registrations>
app.get("/api/health", health_get_0);
// </api-registrations>
export default app;
`;
    await writeFile('src/server/entry.ts', marked);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    await writeFile('src/server/api/orders/POST.ts', 'export default () => {}');

    const result = await regenerateEntryApiRegistrations(tmp);
    expect(result.changed).toBe(true);
    expect(result.routeCount).toBe(2);
    const after = await fs.readFile(path.join(tmp, 'src/server/entry.ts'), 'utf8');
    expect(after).toContain('app.post("/api/orders"');
    expect(after).toContain('app.get("/api/health"');
  });

  it('returns no-change without writing when entry.ts is already up-to-date', async () => {
    // Pins the `content === original` short-circuit: a re-run on an
    // already-converged entry.ts should neither mutate the file nor
    // report changed=true. Mtime comparison verifies no write happened.
    await writeFile('src/server/entry.ts', bareEntry);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    const initial = await regenerateEntryApiRegistrations(tmp);
    expect(initial.changed).toBe(true);
    const afterPath = path.join(tmp, 'src/server/entry.ts');
    const mtimeBefore = (await fs.stat(afterPath)).mtimeMs;
    // Pause briefly to ensure mtime granularity would register a write.
    await new Promise((r) => setTimeout(r, 20));
    const second = await regenerateEntryApiRegistrations(tmp);
    expect(second.changed).toBe(false);
    expect(second.reason).toBe('no-change');
    const mtimeAfter = (await fs.stat(afterPath)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('returns markers-missing without touching a customized entry.ts', async () => {
    const customized = `import express from "express";
const app = express();
// customer wrote their own registration
app.get("/custom", (_req, res) => res.send("ok"));
export default app;
`;
    await writeFile('src/server/entry.ts', customized);
    await writeFile('src/server/api/users/POST.ts', 'export default () => {}');

    const result = await regenerateEntryApiRegistrations(tmp);
    expect(result.reason).toBe('markers-missing');
    expect(result.changed).toBe(false);
    const after = await fs.readFile(path.join(tmp, 'src/server/entry.ts'), 'utf8');
    expect(after).toBe(customized);
  });
});
