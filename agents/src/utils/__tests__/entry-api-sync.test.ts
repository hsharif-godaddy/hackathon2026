import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { WorkspaceFiles } from '../../workspace/files.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
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
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

function createMockFiles(): WorkspaceFiles {
  return {
    view: async ({ path: filePath }) => {
      const full = path.join(tmp, filePath);
      try {
        const content = await fs.readFile(full, 'utf-8');
        return { content, encoding: 'utf-8' as const, path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new DevSupervisorError('not_found', 404, `${filePath}: no such file or directory`);
        }
        throw err;
      }
    },
    readText: async ({ path: filePath }) => {
      const full = path.join(tmp, filePath);
      try {
        return await fs.readFile(full, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new DevSupervisorError('not_found', 404, `${filePath}: no such file or directory`);
        }
        throw err;
      }
    },
    write: async ({ path: filePath, content }) => {
      const full = path.join(tmp, filePath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
      return { bytesWritten: content.length };
    },
    tree: async ({ path: treePath, recursive } = {}) => {
      const base = path.join(tmp, treePath ?? '');
      const entries: Array<{ path: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }> = [];
      async function walk(dir: string, isRoot = false): Promise<void> {
        let names: string[];
        try {
          names = await fs.readdir(dir);
        } catch (err: unknown) {
          if (isRoot && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new DevSupervisorError('not_found', 404, `${treePath}: no such file or directory`);
          }
          return;
        }
        for (const name of names) {
          const full = path.join(dir, name);
          const stat = await fs.stat(full);
          const relPath = path.relative(tmp, full);
          if (stat.isDirectory()) {
            entries.push({ path: relPath, kind: 'directory', size: 0, modifiedAt: '' });
            if (recursive) await walk(full);
          } else {
            entries.push({ path: relPath, kind: 'file', size: stat.size, modifiedAt: '' });
          }
        }
      }
      await walk(base, true);
      return { entries, truncated: false };
    },
  } as unknown as WorkspaceFiles;
}

describe('scanApiDir', () => {
  it('returns empty array for missing dir', async () => {
    const files = createMockFiles();
    const result = await scanApiDir(files);
    expect(result).toEqual([]);
  });

  it('discovers GET / POST / etc in nested folders', async () => {
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    await writeFile('src/server/api/users/POST.ts', 'export default () => {}');
    await writeFile('src/server/api/users/[id]/GET.ts', 'export default () => {}');
    await writeFile('src/server/api/readme.md', '# skip');

    const files = createMockFiles();
    const routes = await scanApiDir(files);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /health',
      'post /users',
      'get /users/:id',
    ]);
  });

  it('depends on tree() returning workspace-rooted entry paths', async () => {
    // scanApiDir derives route paths via path.relative('src/server/api', ...);
    // it only works if tree() returns workspace-rooted paths. Pin the mock to
    // that contract so a future server regression (or mock drift back to
    // dir-relative names) fails loudly here rather than silently mis-routing.
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    const files = createMockFiles();
    const tree = await files.tree({ path: 'src/server/api', recursive: true });
    for (const entry of tree.entries) {
      expect(entry.path.startsWith('src/server/api/')).toBe(true);
    }
  });

  it('propagates non-not-found DevSupervisorError from tree()', async () => {
    // Pins the catch narrow: any DevSupervisorError other than 'not_found'
    // (e.g. permission_denied) must surface so a route tree the supervisor
    // can't read doesn't silently yield a smaller regenerated entry.ts.
    const files = {
      tree: async () => {
        throw new DevSupervisorError('permission_denied', 403, 'tree: permission denied');
      },
    } as unknown as WorkspaceFiles;
    await expect(scanApiDir(files)).rejects.toThrow(/permission denied/);
  });

  it('propagates generic Error from tree()', async () => {
    // Network / timeout / unexpected supervisor errors must surface, not
    // be swallowed as "no API dir".
    const files = {
      tree: async () => {
        throw new Error('socket hang up');
      },
    } as unknown as WorkspaceFiles;
    await expect(scanApiDir(files)).rejects.toThrow(/socket hang up/);
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
    const files = createMockFiles();
    const result = await regenerateEntryApiRegistrations(files);
    expect(result.reason).toBe('no-entry');
    expect(result.changed).toBe(false);
  });

  it('returns no-api-dir when api directory is missing', async () => {
    await writeFile('src/server/entry.ts', bareEntry);
    const files = createMockFiles();
    const result = await regenerateEntryApiRegistrations(files);
    expect(result.reason).toBe('no-api-dir');
  });

  it('propagates non-not-found DevSupervisorError from view()', async () => {
    // Pins the .catch() narrow on entry.ts read: a permission_denied or
    // server error must not masquerade as 'no-entry' (which would silently
    // skip regeneration and drop API routes from the published bundle).
    const files = {
      view: async () => {
        throw new DevSupervisorError('permission_denied', 403, 'entry.ts: permission denied');
      },
      readText: async () => {
        throw new DevSupervisorError('permission_denied', 403, 'entry.ts: permission denied');
      },
      tree: async () => ({ entries: [], truncated: false }),
    } as unknown as WorkspaceFiles;
    await expect(regenerateEntryApiRegistrations(files)).rejects.toThrow(/permission denied/);
  });

  it('propagates generic Error from view()', async () => {
    const files = {
      view: async () => {
        throw new Error('socket hang up');
      },
      readText: async () => {
        throw new Error('socket hang up');
      },
      tree: async () => ({ entries: [], truncated: false }),
    } as unknown as WorkspaceFiles;
    await expect(regenerateEntryApiRegistrations(files)).rejects.toThrow(/socket hang up/);
  });

  it('rewrites bare healthGet shape into marked block and picks up new routes', async () => {
    await writeFile('src/server/entry.ts', bareEntry);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    await writeFile('src/server/api/users/POST.ts', 'export default () => {}');

    const files = createMockFiles();
    const result = await regenerateEntryApiRegistrations(files);
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

    const files = createMockFiles();
    const result = await regenerateEntryApiRegistrations(files);
    expect(result.changed).toBe(true);
    expect(result.routeCount).toBe(2);
    const after = await fs.readFile(path.join(tmp, 'src/server/entry.ts'), 'utf8');
    expect(after).toContain('app.post("/api/orders"');
    expect(after).toContain('app.get("/api/health"');
  });

  it('returns no-change without writing when entry.ts is already up-to-date', async () => {
    await writeFile('src/server/entry.ts', bareEntry);
    await writeFile('src/server/api/health/GET.ts', 'export default () => {}');
    const files = createMockFiles();
    const initial = await regenerateEntryApiRegistrations(files);
    expect(initial.changed).toBe(true);

    const second = await regenerateEntryApiRegistrations(files);
    expect(second.changed).toBe(false);
    expect(second.reason).toBe('no-change');
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

    const files = createMockFiles();
    const result = await regenerateEntryApiRegistrations(files);
    expect(result.reason).toBe('markers-missing');
    expect(result.changed).toBe(false);
    const after = await fs.readFile(path.join(tmp, 'src/server/entry.ts'), 'utf8');
    expect(after).toBe(customized);
  });
});
